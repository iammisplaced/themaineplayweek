#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const args = process.argv.slice(2);

const inputArg = args.find((entry) => entry.startsWith("--input="))?.split("=")[1];
const outDirArg = args.find((entry) => entry.startsWith("--out="))?.split("=")[1];
const siteUrlArg = args.find((entry) => entry.startsWith("--site-url="))?.split("=")[1];
const fromSupabase = args.includes("--from-supabase");
const supabaseUrlArg = args.find((entry) => entry.startsWith("--supabase-url="))?.split("=")[1];
const supabaseAnonKeyArg = args.find((entry) => entry.startsWith("--supabase-anon-key="))?.split("=")[1];
const writeSourceArg = args.find((entry) => entry.startsWith("--write-source="))?.split("=")[1];

const inputPath = path.resolve(cwd, inputArg || "data/film-pages-source.json");
const outputDir = path.resolve(cwd, outDirArg || "films");
const siteUrl = (siteUrlArg || "").replace(/\/$/, "");
const supabaseUrl = String(supabaseUrlArg || process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = String(
  supabaseAnonKeyArg || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || ""
).trim();
const writeSourcePath = writeSourceArg ? path.resolve(cwd, writeSourceArg) : "";

const DEFAULT_NO_POSTER = "/assets/images/noposter.webp";
const BRAND_NAME = "The Maine Playweek";
const PLAYWEEK_RECOMMENDS_STAMP_URL = "/assets/images/playweek%20recommends.png";
const FEATURED_ON_PLAYWEEK_STAMP_URL = "/assets/images/featured%20on%20playweek.png";
const ONE_LINE_WORDMARKS = Object.freeze({
  dark: [
    "Act%20III%20-%20Dark%20-%20One%20Line.png",
    "Deering%20-%20Dark%20-%20One%20Line.png",
    "Empire%20-%20Dark%20-%20One%20Line.png",
    "Fine%20Arts%20-%20Dark%20-%20One%20Line.png",
    "Strand%20-%20Dark%20-%20One%20Line.png",
  ],
  light: [
    "Act%20III%20-%20Light%20-%20One%20Line.png",
    "Deering%20-%20Light%20-%20One%20Line.png",
    "Empire%20-%20Light%20-%20One%20Line.png",
    "Fine%20Arts%20-%20Light%20-%20One%20Line.png",
    "Strand%20-%20Light%20-%20One%20Line.png",
  ],
});
const FILM_SORT_WEIGHTS = Object.freeze({
  tmdbPopularity: 0.2,
  tmdbRating: 0.15,
  tmdbRecency: 0.1,
  upcomingShowings: 0.35,
  theatreCoverage: 0.15,
  staffFavoriteBoost: 0.12,
});
const RELEASE_RECENCY_WINDOW_DAYS = 14;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const source = fromSupabase ? await loadFilmSourceFromSupabase() : JSON.parse(await fs.readFile(inputPath, "utf8"));
  const films = normalizeFilms(source)
    .filter(hasUpcomingShowtimes)
    .sort(compareFilmsByMainAppRanking);

  if (!films.length) {
    const sourceLabel = fromSupabase ? "Supabase" : inputPath;
    throw new Error(`No films with upcoming showtimes found in ${sourceLabel}`);
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await writeCss(outputDir);

  const pageItems = [];
  for (const film of films) {
    const slug = film.slug || slugify(`${film.title}-${film.year || ""}`);
    const fileDir = path.join(outputDir, slug);
    const pagePath = path.join(fileDir, "index.html");
    await fs.mkdir(fileDir, { recursive: true });
    await fs.writeFile(pagePath, renderFilmPage(film, slug, siteUrl), "utf8");
    pageItems.push({ film, slug });
  }

  await fs.writeFile(path.join(outputDir, "index.html"), renderIndexPage(pageItems, siteUrl), "utf8");
  await removeFinderDuplicateDirs(outputDir);

  if (writeSourcePath) {
    await fs.mkdir(path.dirname(writeSourcePath), { recursive: true });
    await fs.writeFile(writeSourcePath, JSON.stringify(source, null, 2), "utf8");
    console.log(`Wrote source snapshot to ${path.relative(cwd, writeSourcePath)}`);
  }

  console.log(`Generated ${pageItems.length} film pages at ${path.relative(cwd, outputDir)}`);
}

async function removeFinderDuplicateDirs(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const duplicates = entries
    .filter((entry) => entry.isDirectory() && /\s\d+$/.test(entry.name))
    .map((entry) => entry.name);

  if (!duplicates.length) return;

  await Promise.all(
    duplicates.map((name) => fs.rm(path.join(rootDir, name), { recursive: true, force: true }))
  );
  console.log(`Removed ${duplicates.length} duplicate Finder folders from ${path.relative(cwd, rootDir)}`);
}

async function loadFilmSourceFromSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase config. Pass --supabase-url/--supabase-anon-key or set SUPABASE_URL and SUPABASE_ANON_KEY."
    );
  }

  const restBase = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
  const [theatres, films, theatreFilms, showings] = await Promise.all([
    fetchAllFromSupabase(
      restBase,
      supabaseAnonKey,
      "theatres",
      "id,name,city,address,website,latitude,longitude",
      "id.asc"
    ),
    fetchAllFromSupabase(
      restBase,
      supabaseAnonKey,
      "films",
      "id,title,year,tmdb_id,synopsis,ticket_link,staff_favorite,staff_favorite_by,featured_on_playweek,featured_on_playweek_url,metadata_source,tmdb_json",
      "id.asc"
    ),
    fetchAllFromSupabase(
      restBase,
      supabaseAnonKey,
      "theatre_films",
      "theatre_id,film_id,ticket_link",
      "theatre_id.asc,film_id.asc"
    ),
    fetchAllFromSupabase(
      restBase,
      supabaseAnonKey,
      "showings",
      "theatre_id,film_id,show_date,times,premium_times",
      "theatre_id.asc,film_id.asc,show_date.asc"
    ),
  ]);

  const theatreById = new Map();
  theatres.forEach((row) => {
    theatreById.set(String(row.id), {
      name: String(row.name || "").trim(),
      city: String(row.city || "").trim(),
      website: String(row.website || "").trim(),
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
    });
  });

  const ticketLinkByPair = new Map();
  theatreFilms.forEach((row) => {
    const ticketLink = String(row.ticket_link || "").trim();
    if (!ticketLink) return;
    ticketLinkByPair.set(`${row.theatre_id}::${row.film_id}`, ticketLink);
  });

  const filmById = new Map();
  films.forEach((row) => {
    const tmdb = isPlainObject(row.tmdb_json) ? row.tmdb_json : {};
    filmById.set(String(row.id), {
      title: String(row.title || "").trim(),
      year: toNumber(row.year),
      tmdbId: row.tmdb_id ? String(row.tmdb_id) : "",
      description: String(row.synopsis || tmdb.overview || "").trim(),
      posterUrl: normalizeSupabasePosterUrl(tmdb.posterUrl || tmdb.poster_path || ""),
      director: String(tmdb.director || "").trim(),
      genres: Array.isArray(tmdb.genres) ? tmdb.genres.filter(Boolean) : [],
      stars: Array.isArray(tmdb.stars) ? tmdb.stars.filter(Boolean) : [],
      releaseDate: String(tmdb.releaseDate || tmdb.release_date || "").trim(),
      popularity: firstFiniteNumber(tmdb.popularity, tmdb.popularity_score),
      voteAverage: firstFiniteNumber(tmdb.voteAverage, tmdb.vote_average),
      voteCount: firstFiniteNumber(tmdb.voteCount, tmdb.vote_count),
      staffFavorite: Boolean(row.staff_favorite ?? tmdb.staffFavorite ?? tmdb.staff_favorite),
      staffFavoriteBy: String(row.staff_favorite_by || tmdb.staffFavoriteBy || tmdb.staff_favorite_by || "").trim(),
      featuredOnPlayweek: Boolean(row.featured_on_playweek ?? tmdb.featuredOnPlayweek ?? tmdb.featured_on_playweek),
      featuredOnPlayweekUrl: String(
        row.featured_on_playweek_url || tmdb.featuredOnPlayweekUrl || tmdb.featured_on_playweek_url || ""
      ).trim(),
      legacyTicketLink: String(row.ticket_link || "").trim(),
      theatres: [],
      showings: [],
    });
  });

  showings.forEach((row) => {
    const film = filmById.get(String(row.film_id));
    const theatre = theatreById.get(String(row.theatre_id));
    if (!film || !theatre) return;
    const theatreLabel = [theatre.name, theatre.city].filter(Boolean).join(", ");
    if (theatreLabel && !film.theatres.includes(theatreLabel)) {
      film.theatres.push(theatreLabel);
    }
    const date = String(row.show_date || "").trim();
    const standardTimes = Array.isArray(row.times) ? row.times : [];
    const premiumTimes = Array.isArray(row.premium_times) ? row.premium_times : [];
    standardTimes.forEach((time) => {
      const timeValue = String(time || "").trim();
      if (!date || !timeValue) return;
      const pairKey = `${row.theatre_id}::${row.film_id}`;
      film.showings.push({
        date,
        time: timeValue,
        isPremium: false,
        theatre: theatre.name || theatreLabel || "Theatre TBA",
        city: theatre.city || "",
        theatreWebsite: theatre.website || "",
        ticketLink: ticketLinkByPair.get(pairKey) || theatre.website || film.legacyTicketLink || "",
        latitude: Number.isFinite(Number(theatre.latitude)) ? Number(theatre.latitude) : undefined,
        longitude: Number.isFinite(Number(theatre.longitude)) ? Number(theatre.longitude) : undefined,
      });
    });
    premiumTimes.forEach((time) => {
      const timeValue = String(time || "").trim();
      if (!date || !timeValue) return;
      const pairKey = `${row.theatre_id}::${row.film_id}`;
      film.showings.push({
        date,
        time: timeValue,
        isPremium: true,
        theatre: theatre.name || theatreLabel || "Theatre TBA",
        city: theatre.city || "",
        theatreWebsite: theatre.website || "",
        ticketLink: ticketLinkByPair.get(pairKey) || theatre.website || film.legacyTicketLink || "",
        latitude: Number.isFinite(Number(theatre.latitude)) ? Number(theatre.latitude) : undefined,
        longitude: Number.isFinite(Number(theatre.longitude)) ? Number(theatre.longitude) : undefined,
      });
    });
  });

  const sourceFilms = Array.from(filmById.values()).filter((film) => film.title);
  return { films: sourceFilms };
}

async function fetchAllFromSupabase(restBase, apiKey, table, select, orderBy = "", pageSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let url = `${restBase}/${encodeURIComponent(table)}?select=${encodeURIComponent(select)}`;
    if (orderBy) {
      url += `&order=${encodeURIComponent(orderBy)}`;
    }
    const response = await fetch(url, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Range: `${from}-${to}`,
        Prefer: "count=none",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase fetch ${table} failed (${response.status}): ${text}`);
    }

    const chunk = await response.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function normalizeFilms(source) {
  if (Array.isArray(source?.films)) {
    return source.films.map(normalizeFlatFilm).filter(Boolean);
  }

  if (Array.isArray(source?.theatreGroups)) {
    const byKey = new Map();

    for (const theatre of source.theatreGroups) {
      const theatreName = stringOrEmpty(theatre?.name);
      const theatreCity = stringOrEmpty(theatre?.city);
      for (const rawFilm of theatre?.films || []) {
        const title = stringOrEmpty(rawFilm?.title);
        if (!title) continue;
        const year = toNumber(rawFilm?.year);
        const tmdbId = rawFilm?.tmdbId ? String(rawFilm.tmdbId) : "";
        const key = `${title.toLowerCase()}::${year || ""}::${tmdbId}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            title,
            year,
            tmdbId,
            description: stringOrEmpty(rawFilm?.tmdb?.overview),
            posterUrl: stringOrEmpty(rawFilm?.tmdb?.posterUrl),
            director: stringOrEmpty(rawFilm?.tmdb?.director),
            genres: Array.isArray(rawFilm?.tmdb?.genres) ? rawFilm.tmdb.genres.filter(Boolean) : [],
            stars: Array.isArray(rawFilm?.tmdb?.stars) ? rawFilm.tmdb.stars.filter(Boolean) : [],
            releaseDate: stringOrEmpty(rawFilm?.tmdb?.releaseDate),
            popularity: firstFiniteNumber(rawFilm?.tmdb?.popularity, rawFilm?.tmdb?.popularity_score),
            voteAverage: firstFiniteNumber(rawFilm?.tmdb?.voteAverage, rawFilm?.tmdb?.vote_average),
            voteCount: firstFiniteNumber(rawFilm?.tmdb?.voteCount, rawFilm?.tmdb?.vote_count),
            staffFavorite: Boolean(rawFilm?.staffFavorite ?? rawFilm?.tmdb?.staffFavorite ?? rawFilm?.tmdb?.staff_favorite),
            staffFavoriteBy: stringOrEmpty(
              rawFilm?.staffFavoriteBy || rawFilm?.tmdb?.staffFavoriteBy || rawFilm?.tmdb?.staff_favorite_by
            ),
            featuredOnPlayweek: Boolean(
              rawFilm?.featuredOnPlayweek ?? rawFilm?.tmdb?.featuredOnPlayweek ?? rawFilm?.tmdb?.featured_on_playweek
            ),
            featuredOnPlayweekUrl: stringOrEmpty(
              rawFilm?.featuredOnPlayweekUrl ||
                rawFilm?.tmdb?.featuredOnPlayweekUrl ||
                rawFilm?.tmdb?.featured_on_playweek_url
            ),
            theatres: [],
            showings: [],
          });
        }
        const film = byKey.get(key);
        const theatreLabel = [theatreName, theatreCity].filter(Boolean).join(", ");
        if (theatreLabel && !film.theatres.includes(theatreLabel)) {
          film.theatres.push(theatreLabel);
        }
        for (const showing of rawFilm?.showings || []) {
          const date = stringOrEmpty(showing?.date);
          for (const time of showing?.times || []) {
            const t = stringOrEmpty(time);
            if (!date || !t) continue;
            film.showings.push({
              date,
              time,
              isPremium: false,
              theatre: theatreName,
              city: theatreCity,
              theatreWebsite: stringOrEmpty(theatre?.website),
              ticketLink: stringOrEmpty(rawFilm?.ticketLink),
              latitude: toNumber(theatre?.latitude),
              longitude: toNumber(theatre?.longitude),
            });
          }
          for (const time of showing?.premiumTimes || []) {
            const t = stringOrEmpty(time);
            if (!date || !t) continue;
            film.showings.push({
              date,
              time: t,
              isPremium: true,
              theatre: theatreName,
              city: theatreCity,
              theatreWebsite: stringOrEmpty(theatre?.website),
              ticketLink: stringOrEmpty(rawFilm?.ticketLink),
              latitude: toNumber(theatre?.latitude),
              longitude: toNumber(theatre?.longitude),
            });
          }
        }
      }
    }

    return Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  return [];
}

function normalizeFlatFilm(film) {
  const title = stringOrEmpty(film?.title);
  if (!title) return null;
  return {
    title,
    year: toNumber(film?.year),
    tmdbId: stringOrEmpty(film?.tmdbId || film?.tmdb_id),
    slug: stringOrEmpty(film?.slug),
    description: stringOrEmpty(film?.description || film?.synopsis || film?.tmdb?.overview),
    posterUrl: stringOrEmpty(film?.posterUrl || film?.tmdb?.posterUrl || film?.tmdb?.posterPath || film?.tmdb?.poster_path),
    director: stringOrEmpty(film?.director || film?.tmdb?.director),
    genres: Array.isArray(film?.genres)
      ? film.genres.filter(Boolean)
      : Array.isArray(film?.tmdb?.genres)
        ? film.tmdb.genres.filter(Boolean)
        : [],
    stars: Array.isArray(film?.stars)
      ? film.stars.filter(Boolean)
      : Array.isArray(film?.tmdb?.stars)
        ? film.tmdb.stars.filter(Boolean)
        : [],
    releaseDate: stringOrEmpty(film?.releaseDate || film?.release_date || film?.tmdb?.releaseDate || film?.tmdb?.release_date),
    popularity: firstFiniteNumber(film?.popularity, film?.tmdb?.popularity, film?.tmdb?.popularity_score),
    voteAverage: firstFiniteNumber(film?.voteAverage, film?.vote_average, film?.tmdb?.voteAverage, film?.tmdb?.vote_average),
    voteCount: firstFiniteNumber(film?.voteCount, film?.vote_count, film?.tmdb?.voteCount, film?.tmdb?.vote_count),
    staffFavorite: Boolean(film?.staffFavorite ?? film?.staff_favorite ?? film?.tmdb?.staffFavorite ?? film?.tmdb?.staff_favorite),
    staffFavoriteBy: stringOrEmpty(
      film?.staffFavoriteBy || film?.staff_favorite_by || film?.tmdb?.staffFavoriteBy || film?.tmdb?.staff_favorite_by
    ),
    featuredOnPlayweek: Boolean(
      film?.featuredOnPlayweek ??
        film?.featured_on_playweek ??
        film?.tmdb?.featuredOnPlayweek ??
        film?.tmdb?.featured_on_playweek
    ),
    featuredOnPlayweekUrl: stringOrEmpty(
      film?.featuredOnPlayweekUrl ||
        film?.featured_on_playweek_url ||
        film?.tmdb?.featuredOnPlayweekUrl ||
        film?.tmdb?.featured_on_playweek_url
    ),
    theatres: Array.isArray(film?.theatres) ? film.theatres.filter(Boolean) : [],
    showings: Array.isArray(film?.showings)
      ? film.showings
          .map((showing) => ({
            date: stringOrEmpty(showing?.date),
            time: stringOrEmpty(showing?.time),
            isPremium: Boolean(
              showing?.isPremium ??
                showing?.is_premium ??
                (stringOrEmpty(showing?.format).toLowerCase() === "premium")
            ),
            theatre: stringOrEmpty(showing?.theatre),
            city: stringOrEmpty(showing?.city),
            theatreWebsite: stringOrEmpty(showing?.theatreWebsite),
            ticketLink: stringOrEmpty(showing?.ticketLink),
            latitude: toNumber(showing?.latitude),
            longitude: toNumber(showing?.longitude),
          }))
          .filter((showing) => showing.date && showing.time)
      : [],
  };
}

function hasUpcomingShowtimes(film) {
  const showings = Array.isArray(film?.showings) ? film.showings : [];
  if (!showings.length) return false;

  const nowEt = getCurrentEasternDateTimeParts();
  for (const showing of showings) {
    const date = String(showing?.date || "").trim();
    const time = String(showing?.time || "").trim();
    if (!date) continue;
    if (date > nowEt.date) return true;
    if (date < nowEt.date) continue;
    const minutes = parseTimeToMinutes(time);
    if (minutes === null) return true;
    if (minutes >= nowEt.minutes) return true;
  }
  return false;
}

function getCurrentEasternDateTimeParts() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return { date, minutes };
}

function renderFilmPage(film, slug, siteUrl) {
  const filmDisplayTitle = film.title;
  const filmTitle = [film.title, film.year].filter(Boolean).join(" ");
  const description =
    film.description ||
    `${film.title} showtimes, theatres, and details from ${BRAND_NAME}.`;
  const canonicalPath = `/films/${slug}/`;
  const canonicalUrl = siteUrl ? `${siteUrl}${canonicalPath}` : canonicalPath.replace(/^\//, "");
  const posterUrl = resolveRelativeAssetPath(film.posterUrl || DEFAULT_NO_POSTER, 2);
  const mainAppUrl = "../..";
  const tmdbMovieUrl = buildTmdbMovieUrl(film.tmdbId);
  const featuredArticleUrl = normalizeExternalUrl(film.featuredOnPlayweekUrl);
  const logoDarkSrc = resolveRelativeAssetPath("/assets/brand/TMP%20logo%20dark.png", 2);
  const logoLightSrc = resolveRelativeAssetPath("/assets/brand/TMP%20logo%20light.png", 2);
  const wordmarksDark = ONE_LINE_WORDMARKS.dark.map((filename) => resolveRelativeAssetPath(`/assets/brand/${filename}`, 2));
  const wordmarksLight = ONE_LINE_WORDMARKS.light.map((filename) =>
    resolveRelativeAssetPath(`/assets/brand/${filename}`, 2)
  );
  const stampMarkup = buildFilmStampMarkup(film, 2);
  const theatreGroups = buildShowtimesByTheatre(film);
  const theatreRowsMarkup = theatreGroups
    .map((group) => {
      const visibleSchedule = group.schedule.slice(0, 4);
      const hiddenSchedule = group.schedule.slice(4);

      const renderDayCards = (rows) =>
        rows
          .map(
            (row) =>
              `<article class="show-day-card">
                <h3 class="show-schedule-day">${escapeHtml(formatIsoDateLabel(row.date))}</h3>
                <div class="show-times-grid">
                  ${row.times.map((time) => `<span class="show-time-chip">${escapeHtml(time)}</span>`).join("")}
                  ${row.premiumTimes.map((time) => `<span class="show-time-chip show-time-chip-premium">Premium ${escapeHtml(time)}</span>`).join("")}
                </div>
              </article>`
          )
          .join("");

      const scheduleMarkup = group.schedule.length
        ? renderDayCards(visibleSchedule)
        : `<article class="show-day-card show-day-card-empty"><span class="show-schedule-times">Showtimes pending</span></article>`;

      const hiddenScheduleMarkup = hiddenSchedule.length
        ? `<details class="show-more-days">
            <summary class="show-more-days-toggle">Show ${hiddenSchedule.length} more day${
              hiddenSchedule.length === 1 ? "" : "s"
            }</summary>
            <div class="show-schedule show-schedule-extra">
              ${renderDayCards(hiddenSchedule)}
            </div>
          </details>`
        : "";

      return `<article class="show-item">
        <div class="show-row">
          <div
            data-theatre-lat="${Number.isFinite(Number(group.latitude)) ? String(group.latitude) : ""}"
            data-theatre-lng="${Number.isFinite(Number(group.longitude)) ? String(group.longitude) : ""}"
          >
            <div class="show-main show-main-theatre">
              ${escapeHtml(group.theatre)}${group.city ? `<span class="show-main-city">, ${escapeHtml(group.city)}</span>` : ""}
            </div>
            <div class="show-schedule">${scheduleMarkup}</div>
            ${hiddenScheduleMarkup}
          </div>
        </div>
        ${group.ticketLink ? `<a class="show-link" href="${escapeHtml(group.ticketLink)}" target="_blank" rel="noopener noreferrer">Tickets</a>` : ""}
      </article>`;
    })
    .join("");

  const ldJson = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: filmTitle,
    description,
    image: absoluteOrPassThrough(film.posterUrl || DEFAULT_NO_POSTER, siteUrl),
    datePublished: film.releaseDate || undefined,
    director: film.director ? [{ "@type": "Person", name: film.director }] : undefined,
    actor: film.stars.map((name) => ({ "@type": "Person", name })),
    genre: film.genres,
    url: canonicalUrl,
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(filmTitle)} | ${BRAND_NAME}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(filmTitle)} | ${BRAND_NAME}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(absoluteOrPassThrough(film.posterUrl || DEFAULT_NO_POSTER, siteUrl))}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(filmTitle)} | ${BRAND_NAME}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(absoluteOrPassThrough(film.posterUrl || DEFAULT_NO_POSTER, siteUrl))}" />
    <link rel="stylesheet" href="../../css/styles.css" />
    <style>
      .film-page-shell {
        width: min(1024px, 100%);
        margin: 0 auto;
      }
      .film-page-brandbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        margin: 0 0 0.5rem;
      }
      .film-page-wordmark {
        display: block;
        height: 72px;
        width: auto;
        max-width: min(72vw, 520px);
        object-fit: contain;
        object-position: left center;
      }
      .film-page-logo {
        width: 72px;
        height: 72px;
        object-fit: contain;
      }
      .film-page-return {
        display: inline-block;
        margin: 0 0 0.9rem;
        color: var(--accent-2);
        font-weight: 700;
        text-decoration: none;
      }
      .film-page-card {
        width: 100%;
      }
      .film-showtimes-heading {
        margin: 0 0 0.6rem;
        color: var(--accent-2);
        font-size: 1rem;
      }
      .film-page-empty {
        margin: 0.45rem 0 0;
        color: var(--muted);
      }
      .film-page-note {
        margin: 0;
        color: var(--muted);
      }
      .film-page-facts {
        margin-top: 0.15rem;
      }
      .film-page-facts .film-fact:first-child .film-fact-value {
        line-height: 1.5;
      }
      .film-page-card .group-film-summary {
        grid-template-columns: minmax(0, 1fr) 104px;
      }
      .film-page-card .group-film-details {
        grid-column: 1;
        grid-row: 1;
      }
      .film-page-card .film-page-poster-rail {
        grid-column: 2;
        grid-row: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.45rem;
      }
      .film-page-card .group-film-poster {
        grid-column: auto;
        grid-row: auto;
        justify-self: auto;
        width: 104px;
        height: 156px;
      }
      .film-page-card .film-page-feature-link {
        margin-top: 0;
        text-align: center;
        justify-content: center;
      }
      .group-card.film-card.film-page-card:not(.film-card-collapsed) .film-favorite-stamp {
        top: auto;
        bottom: 0.45rem;
      }
      .group-card.film-card.film-page-card:not(.film-card-collapsed) .film-featured-stamp {
        top: auto;
        bottom: 0.45rem;
      }
      .group-card.film-card.film-page-card.film-card-staff-favorite.film-card-featured-playweek:not(.film-card-collapsed) .film-favorite-stamp {
        top: auto;
        bottom: 0.45rem;
      }
      .group-card.film-card.film-page-card.film-card-staff-favorite.film-card-featured-playweek:not(.film-card-collapsed) .film-featured-stamp {
        top: auto;
        bottom: 0.45rem;
      }
      .film-info-box {
        margin-bottom: 0.9rem;
      }
      .film-showtimes-box {
        width: 100%;
      }
      .film-showtimes-box .show-item {
        border: 1px solid var(--border);
        border-style: solid;
        background: var(--surface-alt);
        padding: 0.72rem 0.74rem;
        border-radius: 12px;
      }
      .film-showtimes-box .show-list {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.7rem;
      }
      .film-showtimes-box .show-list.show-list-masonry {
        grid-template-columns: repeat(var(--show-columns, 2), minmax(0, 1fr));
        align-items: start;
      }
      .film-showtimes-box .show-masonry-column {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
      }
      .film-showtimes-box .show-main {
        margin-bottom: 0.5rem;
      }
      .film-showtimes-box .show-main-theatre {
        font-size: 1rem;
        font-weight: 700;
        line-height: 1.25;
      }
      .film-showtimes-box .show-main-city {
        color: var(--muted);
        font-weight: 600;
      }
      .film-showtimes-box .show-schedule {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.55rem;
        margin-top: 0;
      }
      .film-showtimes-box .show-day-card {
        margin: 0;
        padding: 0.55rem 0.62rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--surface-soft);
      }
      .film-showtimes-box .show-day-card-empty {
        display: grid;
        align-items: center;
      }
      .film-showtimes-box .show-schedule-day {
        margin: 0 0 0.38rem;
      }
      .film-showtimes-box .show-times-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.34rem;
      }
      .film-showtimes-box .show-more-days {
        margin-top: 0.5rem;
      }
      .film-showtimes-box .show-more-days-toggle {
        list-style: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: #f8f2ea;
        color: var(--accent-2);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 0.22rem 0.62rem;
      }
      .film-showtimes-box .show-more-days-toggle::-webkit-details-marker {
        display: none;
      }
      .film-showtimes-box .show-more-days-toggle:hover,
      .film-showtimes-box .show-more-days-toggle:focus-visible {
        background: var(--hover-soft-2);
        border-color: #c8beb1;
      }
      .film-showtimes-box .show-schedule-extra {
        margin-top: 0.48rem;
      }
      .film-showtimes-box .show-time-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 1.7rem;
        padding: 0.12rem 0.46rem;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel);
        color: var(--ink);
        font-size: 0.84rem;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
      }
      .film-showtimes-box .show-time-chip.show-time-chip-premium {
        border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
        background: color-mix(in srgb, var(--accent) 12%, var(--panel));
      }
      .film-showtimes-box .show-item {
        align-self: stretch;
        width: 100%;
        margin: 0;
      }
      .location-sort-controls {
        margin: 0 0 0.75rem;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface-alt);
        padding: 0.66rem 0.7rem;
      }
      .location-sort-title {
        margin: 0 0 0.2rem;
        color: var(--accent-2);
        font-size: 0.84rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .location-sort-copy {
        margin: 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .location-sort-actions {
        margin-top: 0.56rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.45rem;
      }
      .location-sort-actions button,
      .location-sort-actions input {
        min-height: 2rem;
      }
      .location-sort-actions input {
        width: 7.2rem;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0 0.5rem;
        background: var(--panel);
        color: var(--ink);
      }
      .location-sort-actions button {
        border: 1px solid var(--border);
        border-radius: 999px;
        background: #f8f2ea;
        color: var(--accent-2);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 0.2rem 0.62rem;
        cursor: pointer;
      }
      .location-sort-status {
        margin: 0.5rem 0 0;
        font-size: 0.84rem;
        color: var(--muted);
      }
      :root[data-theme="dark"] .film-showtimes-box .show-more-days-toggle,
      :root[data-theme="dark"] .location-sort-actions button {
        border-color: #3c504a;
        background: #1a2522;
        color: #deeee9;
      }
      :root[data-theme="dark"] .film-showtimes-box .show-more-days-toggle:hover,
      :root[data-theme="dark"] .film-showtimes-box .show-more-days-toggle:focus-visible,
      :root[data-theme="dark"] .location-sort-actions button:hover,
      :root[data-theme="dark"] .location-sort-actions button:focus-visible {
        border-color: #4f665f;
        background: #24312d;
      }
      @media (min-width: 860px) {
        .film-page-card .group-film-summary {
          grid-template-columns: minmax(0, 1fr) 124px;
        }
        .film-page-card .group-film-poster {
          width: 124px;
          height: 186px;
        }
        .film-showtimes-box .show-list {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <script type="application/ld+json">${jsonForScript(pruneUndefined(ldJson))}</script>
  </head>
  <body>
    <main class="film-page-shell">
      <div class="film-page-brandbar">
        <img id="filmPageWordmark" class="film-page-wordmark" src="${escapeHtml(wordmarksLight[0] || "")}" alt="${BRAND_NAME}" />
        <img id="filmPageLogo" class="film-page-logo" src="${escapeHtml(logoDarkSrc)}" alt="" aria-hidden="true" />
      </div>
      <a class="film-page-return" href="${escapeHtml(mainAppUrl)}">Go back...</a>
      <article class="group-card film-card film-page-card film-info-box${film.staffFavorite ? " film-card-staff-favorite" : ""}${
        film.featuredOnPlayweek ? " film-card-featured-playweek" : ""
      }">
        <h1 class="group-title group-title-film">${escapeHtml(filmDisplayTitle)}</h1>
        <div class="group-film-summary">
          <div class="film-page-poster-rail">
            <img class="group-film-poster" src="${escapeHtml(posterUrl)}" alt="Poster for ${escapeHtml(filmDisplayTitle)}" loading="lazy" />
            ${
              featuredArticleUrl
                ? `<a class="group-feature-link film-page-feature-link" href="${escapeHtml(featuredArticleUrl)}" target="_blank" rel="noopener noreferrer">Read feature</a>`
                : ""
            }
          </div>
          ${stampMarkup}
          <div class="group-film-details">
            <div class="group-film-facts film-page-facts">
              ${buildFilmFactsMarkup(film, description)}
            </div>
            ${tmdbMovieUrl ? `<a class="group-tmdb-link" href="${escapeHtml(tmdbMovieUrl)}" target="_blank" rel="noopener noreferrer">View on TMDb</a>` : ""}
          </div>
        </div>
      </article>

      <section class="group-card film-showtimes-box">
        <h2 class="film-showtimes-heading">Showtimes by Theatre</h2>
        <section class="location-sort-controls" aria-label="Location sorting">
          <h3 class="location-sort-title">Near You</h3>
          <p id="locationSortCopy" class="location-sort-copy">Sort theatres by distance using your saved location, current location, or ZIP code.</p>
          <div class="location-sort-actions">
            <button id="locationSortUseDevice" type="button">Use My Location</button>
            <form id="locationSortZipForm">
              <input id="locationSortZipInput" type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="ZIP code" aria-label="ZIP code" />
              <button type="submit">Use ZIP</button>
            </form>
          </div>
          <p id="locationSortStatus" class="location-sort-status" aria-live="polite"></p>
        </section>
        ${
          theatreRowsMarkup
            ? `<div class="show-list">${theatreRowsMarkup}</div>`
            : `<p class="film-page-empty">Showtimes not published yet.</p>`
        }
      </section>
      <section class="site-meta" aria-label="Site information">
        <p>&copy; 2026 The Maine Playweek, LLC.</p>
        <p>hello@themaineplayweek.com</p>
      </section>
    </main>
    <script>
      (() => {
        const LIGHT_THEME = "light";
        const DARK_THEME = "dark";
        const THEME_STORAGE_KEY = "tmp-theme";
        const logo = document.getElementById("filmPageLogo");
        const wordmark = document.getElementById("filmPageWordmark");
        const logoDarkSrc = ${jsonForScript(logoDarkSrc)};
        const logoLightSrc = ${jsonForScript(logoLightSrc)};
        const wordmarks = {
          light: ${jsonForScript(wordmarksLight)},
          dark: ${jsonForScript(wordmarksDark)},
        };

        function getTheme() {
          try {
            const stored = localStorage.getItem(THEME_STORAGE_KEY);
            if (stored === LIGHT_THEME || stored === DARK_THEME) return stored;
          } catch {}
          return window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK_THEME : LIGHT_THEME;
        }

        function pickRandom(list) {
          if (!Array.isArray(list) || !list.length) return "";
          return list[Math.floor(Math.random() * list.length)] || "";
        }

        function applyTheme(theme) {
          const nextTheme = theme === DARK_THEME ? DARK_THEME : LIGHT_THEME;
          document.documentElement.setAttribute("data-theme", nextTheme);
          if (logo) {
            logo.src = nextTheme === DARK_THEME ? logoLightSrc : logoDarkSrc;
          }
          if (wordmark) {
            const wordmarkTheme = nextTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
            const chosen = pickRandom(wordmarks[wordmarkTheme]);
            if (chosen) wordmark.src = chosen;
          }
        }

        applyTheme(getTheme());
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener?.("change", () => applyTheme(getTheme()));
        window.addEventListener("storage", (event) => {
          if (event.key !== THEME_STORAGE_KEY) return;
          applyTheme(getTheme());
        });

        const STORAGE_KEYS = ["tmp-location-preference-v1", "tmp-film-pages-location-v1"];
        const useDeviceButton = document.getElementById("locationSortUseDevice");
        const zipForm = document.getElementById("locationSortZipForm");
        const zipInput = document.getElementById("locationSortZipInput");
        const status = document.getElementById("locationSortStatus");
        const list = document.querySelector(".film-showtimes-box .show-list");
        const theatreItems = Array.from(document.querySelectorAll(".film-showtimes-box .show-item"));
        if (!theatreItems.length || !list) return;

        function setStatus(message) {
          if (!status) return;
          status.textContent = message || "";
        }

        function readSavedLocation() {
          for (const key of STORAGE_KEYS) {
            try {
              const raw = localStorage.getItem(key);
              if (!raw) continue;
              const parsed = JSON.parse(raw);
              const lat = Number(parsed?.lat);
              const lng = Number(parsed?.lng);
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                return { lat, lng, mode: parsed?.mode || "" };
              }
            } catch {}
          }
          return null;
        }

        function saveLocation(lat, lng, mode, zip) {
          const payload = { lat, lng, mode: mode || "", zip: zip || "" };
          localStorage.setItem("tmp-film-pages-location-v1", JSON.stringify(payload));
        }

        function haversineMiles(lat1, lng1, lat2, lng2) {
          const toRad = (d) => (d * Math.PI) / 180;
          const R = 3958.8;
          const dLat = toRad(lat2 - lat1);
          const dLng = toRad(lng2 - lng1);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
          return 2 * R * Math.asin(Math.sqrt(a));
        }

        function getMasonryColumnCount() {
          if (window.matchMedia("(max-width: 859px)").matches) return 1;
          const width = list.clientWidth;
          if (!width) return 2;
          const minColumnWidth = 320;
          const gap = 12;
          return Math.max(2, Math.floor((width + gap) / (minColumnWidth + gap)));
        }

        function applyShowtimesLayout(items) {
          const orderedItems = Array.isArray(items) ? items : theatreItems;
          const columns = getMasonryColumnCount();
          list.innerHTML = "";

          if (columns <= 1) {
            list.classList.remove("show-list-masonry");
            list.style.removeProperty("--show-columns");
            orderedItems.forEach((item) => list.appendChild(item));
            return;
          }

          list.classList.add("show-list-masonry");
          list.style.setProperty("--show-columns", String(columns));
          const fragment = document.createDocumentFragment();
          const columnEls = Array.from({ length: columns }, () => {
            const col = document.createElement("div");
            col.className = "show-masonry-column";
            fragment.appendChild(col);
            return col;
          });
          orderedItems.forEach((item, index) => {
            columnEls[index % columns].appendChild(item);
          });
          list.appendChild(fragment);
        }

        function sortByDistance(lat, lng, sourceLabel) {
          const scored = theatreItems.map((item) => {
            const holder = item.querySelector("[data-theatre-lat]");
            const itemLat = Number(holder?.dataset?.theatreLat);
            const itemLng = Number(holder?.dataset?.theatreLng);
            let distance = Number.POSITIVE_INFINITY;
            if (Number.isFinite(itemLat) && Number.isFinite(itemLng)) {
              distance = haversineMiles(lat, lng, itemLat, itemLng);
            }
            return { item, distance };
          });

          scored.sort((a, b) => {
            const aFinite = Number.isFinite(a.distance);
            const bFinite = Number.isFinite(b.distance);
            if (aFinite && bFinite && a.distance !== b.distance) return a.distance - b.distance;
            if (aFinite !== bFinite) return aFinite ? -1 : 1;
            const aLabel = a.item.querySelector(".show-main-theatre")?.textContent || "";
            const bLabel = b.item.querySelector(".show-main-theatre")?.textContent || "";
            return aLabel.localeCompare(bLabel);
          });
          applyShowtimesLayout(scored.map(({ item }) => item));
          setStatus("Sorted by distance using " + sourceLabel + ".");
        }

        async function geocodeZip(zip) {
          const cleaned = String(zip || "").trim();
          if (!/^\\d{5}$/.test(cleaned)) {
            throw new Error("Enter a valid 5-digit ZIP code.");
          }
          const response = await fetch("https://api.zippopotam.us/us/" + cleaned);
          if (!response.ok) throw new Error("Could not find that ZIP code.");
          const json = await response.json();
          const place = Array.isArray(json?.places) ? json.places[0] : null;
          const lat = Number(place?.latitude);
          const lng = Number(place?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("ZIP lookup did not return coordinates.");
          return { lat, lng, zip: cleaned };
        }

        useDeviceButton?.addEventListener("click", () => {
          if (!navigator.geolocation) {
            setStatus("Location is not supported in this browser.");
            return;
          }
          setStatus("Getting your location...");
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const lat = Number(position.coords.latitude);
              const lng = Number(position.coords.longitude);
              saveLocation(lat, lng, "device", "");
              sortByDistance(lat, lng, "device location");
            },
            () => {
              setStatus("Could not get your location. You can enter ZIP instead.");
            },
            { enableHighAccuracy: true, timeout: 12000 }
          );
        });

        zipForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            setStatus("Looking up ZIP...");
            const geo = await geocodeZip(zipInput?.value || "");
            saveLocation(geo.lat, geo.lng, "zip", geo.zip);
            sortByDistance(geo.lat, geo.lng, "ZIP " + geo.zip);
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Could not use that ZIP code.");
          }
        });

        const saved = readSavedLocation();
        if (saved) {
          sortByDistance(saved.lat, saved.lng, saved.mode === "zip" ? "saved ZIP" : "saved location");
        } else {
          applyShowtimesLayout(theatreItems);
          setStatus("Choose your location to sort theatres by distance.");
        }

        let resizeTimer = null;
        window.addEventListener("resize", () => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            const currentItems = Array.from(list.querySelectorAll(".show-item"));
            applyShowtimesLayout(currentItems);
          }, 90);
        });
      })();
    </script>
  </body>
</html>`;
}

function renderIndexPage(items, siteUrl) {
  const canonicalPath = "/films/";
  const canonicalUrl = siteUrl ? `${siteUrl}${canonicalPath}` : canonicalPath.replace(/^\//, "");
  const cards = items
    .map(({ film, slug }) => {
      const title = film.title;
      const description =
        film.description || `${film.title} showtimes and details from ${BRAND_NAME}.`;
      const poster = resolveRelativeAssetPath(film.posterUrl || DEFAULT_NO_POSTER, 1);
      const stampMarkup = buildFilmStampMarkup(film, 1);
      return `<article class="group-card film-card film-card-collapsed${film.staffFavorite ? " film-card-staff-favorite" : ""}${
        film.featuredOnPlayweek ? " film-card-featured-playweek" : ""
      }">
  <h2 class="group-title group-title-film">${escapeHtml(title)}</h2>
  <a class="film-expand-toggle film-page-link" href="./${slug}/" aria-label="View page for ${escapeHtml(title)}">View Film Page</a>
  <div class="group-film-summary">
    <a class="film-page-link film-page-poster-link" href="./${slug}/" aria-label="Open page for ${escapeHtml(title)}">
      <img class="group-film-poster" src="${escapeHtml(poster)}" alt="Poster for ${escapeHtml(title)}" loading="lazy" />
    </a>
    ${stampMarkup}
    <div class="group-film-details">
      <p class="group-film-facts hidden">${escapeHtml(description)}</p>
      <a class="group-feature-link hidden" href="./${slug}/">View Film Page</a>
    </div>
  </div>
  <ul class="show-list"></ul>
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Film Pages | ${BRAND_NAME}</title>
    <meta
      name="description"
      content="Prototype index of SEO-friendly static film pages for The Maine Playweek."
    />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <link rel="stylesheet" href="../css/styles.css" />
    <style>
      .film-index-shell {
        width: min(1024px, 100%);
        margin: 0 auto;
      }
      .film-index-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.6rem;
        margin: 0 0 0.75rem;
      }
      .film-index-header h1 {
        margin: 0;
      }
      .film-index-header a {
        color: var(--accent-2);
        font-weight: 700;
      }
      .film-index-note {
        margin: 0 0 1rem;
        color: var(--muted);
      }
      .film-page-link {
        text-decoration: none;
      }
      .film-page-poster-link {
        display: block;
      }
    </style>
  </head>
  <body>
    <main class="film-index-shell">
      <div class="film-index-header">
        <h1>All Films</h1>
        <a href="../index.html">Back to Showtimes</a>
      </div>
      <p class="film-index-note">Prototype: each card button opens a dedicated film page.</p>
      <section class="results results-masonry" data-view="films" aria-live="polite">${cards}</section>
    </main>
  </body>
</html>`;
}

async function writeCss(outputDir) {
  const css = `:root {
  color-scheme: light;
  --bg: #f4efe7;
  --panel: #fffdf8;
  --ink: #1d1f1f;
  --muted: #5a6160;
  --accent: #c54828;
  --border: #d7d0c2;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "IBM Plex Sans", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at 10% 10%, #eadac6 0%, transparent 35%),
    radial-gradient(circle at 100% 0%, #d8e4dd 0%, transparent 30%),
    var(--bg);
}

.film-page,
.film-index {
  width: min(980px, 100%);
  margin: 0 auto;
  padding: 2rem 1rem 3rem;
}

.back-link {
  display: inline-block;
  margin-bottom: 1rem;
  color: var(--accent);
  font-weight: 700;
  text-decoration: none;
}

.hero {
  display: grid;
  grid-template-columns: minmax(180px, 260px) 1fr;
  gap: 1.25rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem;
}

.hero h1 {
  margin: 0.1rem 0 0.5rem;
}

.poster {
  width: 100%;
  height: auto;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: #e6e1d6;
}

.eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.meta {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}

.meta span {
  display: inline-block;
  min-width: 110px;
  color: var(--muted);
  font-weight: 600;
}

.panel {
  margin-top: 1rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem;
}

.panel h2 {
  margin: 0 0 0.6rem;
}

.panel ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.3rem;
}

.film-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.film-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.film-card img {
  width: 100%;
  height: 320px;
  object-fit: cover;
  display: block;
  background: #e6e1d6;
}

.film-link {
  color: inherit;
  text-decoration: none;
}

.film-link h2 {
  margin: 0.75rem 0.8rem 0.35rem;
  font-size: 1.06rem;
}

.film-link p {
  margin: 0 0.8rem 0.9rem;
  color: var(--muted);
}

.intro {
  color: var(--muted);
}

@media (max-width: 680px) {
  .hero {
    grid-template-columns: 1fr;
  }
}`;

  await fs.writeFile(path.join(outputDir, "film-pages.css"), css, "utf8");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, 80);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteOrPassThrough(url, siteUrl) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (!siteUrl) return url.replace(/^\//, "");
  if (url.startsWith("/")) return `${siteUrl}${url}`;
  return `${siteUrl}/${url}`;
}

function resolveRelativeAssetPath(url, depthToRoot) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return url;
  const depthPrefix = "../".repeat(Math.max(0, depthToRoot));
  return `${depthPrefix}${url.replace(/^\//, "")}`;
}

function buildFilmFactsMarkup(film, synopsis) {
  const facts = [
    { label: "Synopsis", value: synopsis || "Not listed" },
    { label: "Director", value: film.director || "Not listed" },
    { label: "Genres", value: film.genres.length ? film.genres.join(", ") : "Not listed" },
    { label: "Stars", value: film.stars.length ? film.stars.join(", ") : "Not listed" },
    { label: "Release Date", value: film.releaseDate || "Not listed" },
  ];

  return facts
    .map(
      (fact) =>
        `<div class="film-fact"><span class="film-fact-label">${escapeHtml(
          fact.label
        )}</span><span class="film-fact-value">${escapeHtml(fact.value)}</span></div>`
    )
    .join("");
}

function buildTmdbMovieUrl(tmdbId) {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) return "";
  return `https://www.themoviedb.org/movie/${id}`;
}

function normalizeExternalUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed;
}

function buildFilmStampMarkup(film, depthToRoot) {
  const stamps = [];
  if (film?.staffFavorite) {
    const titleText = film?.staffFavoriteBy
      ? ` title="${escapeHtml(`Playweek recommends (${String(film.staffFavoriteBy)})`)}"`
      : "";
    stamps.push(
      `<img class="film-favorite-stamp" src="${escapeHtml(
        resolveRelativeAssetPath(PLAYWEEK_RECOMMENDS_STAMP_URL, depthToRoot)
      )}" alt="Playweek recommends" loading="lazy" decoding="async"${titleText} />`
    );
  }
  if (film?.featuredOnPlayweek) {
    stamps.push(
      `<img class="film-featured-stamp" src="${escapeHtml(
        resolveRelativeAssetPath(FEATURED_ON_PLAYWEEK_STAMP_URL, depthToRoot)
      )}" alt="Featured on the Playweek" loading="lazy" decoding="async" />`
    );
  }
  return stamps.join("");
}

function buildShowtimesByTheatre(film) {
  const byTheatre = new Map();

  for (const showing of film.showings || []) {
    const theatre = showing.theatre || "Theatre TBA";
    const city = showing.city || "";
    const key = `${theatre}::${city}`;
    if (!byTheatre.has(key)) {
      byTheatre.set(key, {
        theatre,
        city,
        ticketLink: String(showing.ticketLink || showing.theatreWebsite || "").trim(),
        latitude: Number.isFinite(Number(showing.latitude)) ? Number(showing.latitude) : undefined,
        longitude: Number.isFinite(Number(showing.longitude)) ? Number(showing.longitude) : undefined,
        byDate: new Map(),
      });
    }
    const entry = byTheatre.get(key);
    if (!entry.ticketLink && (showing.ticketLink || showing.theatreWebsite)) {
      entry.ticketLink = String(showing.ticketLink || showing.theatreWebsite).trim();
    }
    if (!Number.isFinite(Number(entry.latitude)) && Number.isFinite(Number(showing.latitude))) {
      entry.latitude = Number(showing.latitude);
    }
    if (!Number.isFinite(Number(entry.longitude)) && Number.isFinite(Number(showing.longitude))) {
      entry.longitude = Number(showing.longitude);
    }
    const byDate = entry.byDate;
    if (!byDate.has(showing.date)) {
      byDate.set(showing.date, { times: [], premiumTimes: [] });
    }
    const slot = byDate.get(showing.date);
    if (showing.isPremium) {
      slot.premiumTimes.push(showing.time);
    } else {
      slot.times.push(showing.time);
    }
  }

  const grouped = Array.from(byTheatre.values()).map((entry) => {
    const schedule = Array.from(entry.byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        date,
        times: dedupeTimes(value?.times || []),
        premiumTimes: dedupeTimes(value?.premiumTimes || []),
      }));
    return {
      theatre: entry.theatre,
      city: entry.city,
      ticketLink: entry.ticketLink,
      latitude: entry.latitude,
      longitude: entry.longitude,
      schedule,
    };
  });

  if (!grouped.length && Array.isArray(film.theatres) && film.theatres.length) {
    return film.theatres.map((theatreLabel) => {
      const [theatreName, ...rest] = String(theatreLabel || "").split(",");
      return {
        theatre: theatreName?.trim() || "Theatre TBA",
        city: rest.join(",").trim(),
        ticketLink: "",
        latitude: undefined,
        longitude: undefined,
        schedule: [],
      };
    });
  }

  return grouped.sort((a, b) => {
    const theatreCompare = a.theatre.localeCompare(b.theatre);
    if (theatreCompare !== 0) return theatreCompare;
    return String(a.city || "").localeCompare(String(b.city || ""));
  });
}

function dedupeTimes(times) {
  return Array.from(new Set((times || []).filter(Boolean))).sort(compareShowTimes);
}

function compareShowTimes(a, b) {
  return toSortableMinutes(a) - toSortableMinutes(b);
}

function toSortableMinutes(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = Number(match[1]) % 12;
  const minute = Number(match[2]);
  if (match[3] === "PM") hour += 12;
  return hour * 60 + minute;
}

function parseTimeToMinutes(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (match[3] === "PM") hour += 12;
  return hour * 60 + minute;
}

function formatIsoDateLabel(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(isoDate || "");
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month, day));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function normalizeSupabasePosterUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://image.tmdb.org/t/p/w342${raw}`;
  return raw;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compareFilmsByMainAppRanking(a, b) {
  const scoreA = getFilmSortScore(a);
  const scoreB = getFilmSortScore(b);
  if (scoreA !== scoreB) return scoreB - scoreA;

  const normalizedCompare = normalizeSortTitle(a?.title).localeCompare(normalizeSortTitle(b?.title));
  if (normalizedCompare !== 0) return normalizedCompare;

  const yearA = Number(a?.year || 0);
  const yearB = Number(b?.year || 0);
  if (yearA !== yearB) return yearA - yearB;

  return String(a?.title || "").localeCompare(String(b?.title || ""));
}

function getFilmSortScore(film) {
  const popularity = normalizeScoreRange(toFiniteNumber(film?.popularity), 100);
  const voteAverage = normalizeScoreRange(toFiniteNumber(film?.voteAverage), 10);
  const voteCount = toFiniteNumber(film?.voteCount);
  const voteConfidence = normalizeLogRange(voteCount, 10000);
  const ratingScore = voteAverage * voteConfidence;
  const releaseRecency = calculateReleaseRecencyScore(film?.releaseDate);

  const upcomingTimes = countUpcomingShowings(film);
  const theatreCoverage = normalizeLogRange(countUpcomingTheatreCoverage(film), 30);
  const upcomingShowings = normalizeLogRange(upcomingTimes, 80);
  const editorialBoost = film?.staffFavorite ? FILM_SORT_WEIGHTS.staffFavoriteBoost : 0;

  return (
    FILM_SORT_WEIGHTS.tmdbPopularity * popularity +
    FILM_SORT_WEIGHTS.tmdbRating * ratingScore +
    FILM_SORT_WEIGHTS.tmdbRecency * releaseRecency +
    FILM_SORT_WEIGHTS.upcomingShowings * upcomingShowings +
    FILM_SORT_WEIGHTS.theatreCoverage * theatreCoverage +
    editorialBoost
  );
}

function countUpcomingShowings(film) {
  return (film?.showings || []).reduce((total, showing) => (
    total + (isUpcomingShowing(showing) ? 1 : 0)
  ), 0);
}

function countUpcomingTheatreCoverage(film) {
  const keys = new Set();
  (film?.showings || []).forEach((showing) => {
    if (!isUpcomingShowing(showing)) return;
    keys.add(`${String(showing?.theatre || "").trim()}::${String(showing?.city || "").trim()}`);
  });
  return keys.size;
}

function isUpcomingShowing(showing) {
  const date = String(showing?.date || "").trim();
  const time = String(showing?.time || "").trim();
  if (!date) return false;
  const nowEt = getCurrentEasternDateTimeParts();
  if (date > nowEt.date) return true;
  if (date < nowEt.date) return false;
  const minutes = parseTimeToMinutes(time);
  if (minutes === null) return true;
  return minutes >= nowEt.minutes;
}

function calculateReleaseRecencyScore(releaseDate) {
  const release = parseIsoDateLike(releaseDate);
  if (!release) return 0;
  const daysSinceRelease = (Date.now() - release.getTime()) / 86400000;
  if (!Number.isFinite(daysSinceRelease)) return 0;
  if (daysSinceRelease <= 0) return 1;
  if (daysSinceRelease >= RELEASE_RECENCY_WINDOW_DAYS) return 0;
  return 1 - (daysSinceRelease / RELEASE_RECENCY_WINDOW_DAYS);
}

function parseIsoDateLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const head = raw.slice(0, 10);
  const match = head.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month, day));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function normalizeScoreRange(value, max) {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

function normalizeLogRange(value, expectedHigh) {
  if (!Number.isFinite(value) || value <= 0 || expectedHigh <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log1p(value) / Math.log1p(expectedHigh)));
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSortTitle(value) {
  return String(value || "")
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^the\s+/i, "")
    .toLowerCase();
}

function pruneUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map(pruneUndefined).filter((entry) => entry !== undefined);
  }
  if (obj && typeof obj === "object") {
    const next = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      next[key] = pruneUndefined(value);
    }
    return next;
  }
  return obj;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}
