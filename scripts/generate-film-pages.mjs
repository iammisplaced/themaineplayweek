#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import {
  SHOWTIME_COLUMNS,
  groupShowtimesIntoShowings,
  buildFilmSlug,
  escapeHtml,
  getFilmSortBreakdown,
  getShowtimeNote,
  isPlainObject,
  normalizeSortTitle,
  compareTimes,
  to24HourTime,
} from "../js/shared.js";

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
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const source = fromSupabase ? await loadFilmSourceFromSupabase() : JSON.parse(await fs.readFile(inputPath, "utf8"));
  const films = normalizeFilms(source)
    .filter(hasUpcomingShowtimes)
    .map(prunePastShowings)
    .sort(compareFilmsByMainAppRanking);

  if (!films.length) {
    const sourceLabel = fromSupabase ? "Supabase" : inputPath;
    throw new Error(`No films with upcoming showtimes found in ${sourceLabel}`);
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const pageItems = [];
  for (const film of films) {
    const slug = film.slug || buildFilmSlug(film.title, film.year);
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
  const [theatres, films, theatreFilms, showtimes, festivals] = await Promise.all([
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
      "id,title,year,tmdb_id,synopsis,staff_favorite,staff_favorite_by,featured_on_playweek,featured_on_playweek_url,metadata_source,tmdb_json",
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
      "showtimes",
      SHOWTIME_COLUMNS,
      "theatre_id.asc,film_id.asc,show_date.asc,start_time.asc"
    ),
    fetchAllFromSupabase(
      restBase,
      supabaseAnonKey,
      "festivals",
      "id,name",
      "id.asc"
    ),
  ]);
  const showings = groupShowtimesIntoShowings(showtimes);
  const festivalNameById = new Map(
    festivals
      .map((row) => [Number(row.id), String(row.name || "").trim()])
      .filter(([id, name]) => Number.isInteger(id) && Boolean(name))
  );

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
      runtime: firstFiniteNumber(tmdb.runtime),
      certification: String(tmdb.certification || "").trim(),
      originalLanguage: String(tmdb.originalLanguage || "").trim(),
      originalLanguageName: String(tmdb.originalLanguageName || "").trim(),
      popularity: firstFiniteNumber(tmdb.popularity, tmdb.popularity_score),
      voteAverage: firstFiniteNumber(tmdb.voteAverage, tmdb.vote_average),
      voteCount: firstFiniteNumber(tmdb.voteCount, tmdb.vote_count),
      staffFavorite: Boolean(row.staff_favorite ?? tmdb.staffFavorite ?? tmdb.staff_favorite),
      staffFavoriteBy: String(row.staff_favorite_by || tmdb.staffFavoriteBy || tmdb.staff_favorite_by || "").trim(),
      featuredOnPlayweek: Boolean(row.featured_on_playweek ?? tmdb.featuredOnPlayweek ?? tmdb.featured_on_playweek),
      featuredOnPlayweekUrl: String(
        row.featured_on_playweek_url || tmdb.featuredOnPlayweekUrl || tmdb.featured_on_playweek_url || ""
      ).trim(),
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
        festivalName: festivalNameById.get(Number(row.festival_id)) || "",
        room: String(row.room || "").trim(),
        notes: String(row.notes || "").trim(),
        theatre: theatre.name || theatreLabel || "Theatre TBA",
        city: theatre.city || "",
        theatreWebsite: theatre.website || "",
        ticketLink: ticketLinkByPair.get(pairKey) || theatre.website || "",
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
        festivalName: festivalNameById.get(Number(row.festival_id)) || "",
        room: String(row.room || "").trim(),
        notes: String(row.notes || "").trim(),
        theatre: theatre.name || theatreLabel || "Theatre TBA",
        city: theatre.city || "",
        theatreWebsite: theatre.website || "",
        ticketLink: ticketLinkByPair.get(pairKey) || theatre.website || "",
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
  const festivalNameById = new Map(
    (Array.isArray(source?.festivals) ? source.festivals : [])
      .map((festival) => [Number(festival?.id), String(festival?.name || "").trim()])
      .filter(([id, name]) => Number.isInteger(id) && Boolean(name))
  );
  if (Array.isArray(source?.films)) {
    return source.films.map((film) => normalizeFlatFilm(film, festivalNameById)).filter(Boolean);
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
            runtime: firstFiniteNumber(rawFilm?.tmdb?.runtime),
            certification: stringOrEmpty(rawFilm?.tmdb?.certification),
            originalLanguage: stringOrEmpty(rawFilm?.tmdb?.originalLanguage),
            originalLanguageName: stringOrEmpty(rawFilm?.tmdb?.originalLanguageName),
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
              festivalName:
                festivalNameById.get(Number(showing?.festivalId)) ||
                stringOrEmpty(showing?.festivalName),
              room: stringOrEmpty(showing?.room),
              notes: stringOrEmpty(showing?.notes),
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
              festivalName:
                festivalNameById.get(Number(showing?.festivalId)) ||
                stringOrEmpty(showing?.festivalName),
              room: stringOrEmpty(showing?.room),
              notes: stringOrEmpty(showing?.notes),
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

function normalizeFlatFilm(film, festivalNameById = new Map()) {
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
    runtime: firstFiniteNumber(film?.runtime, film?.tmdb?.runtime),
    certification: stringOrEmpty(film?.certification || film?.tmdb?.certification),
    originalLanguage: stringOrEmpty(film?.originalLanguage || film?.tmdb?.originalLanguage),
    originalLanguageName: stringOrEmpty(film?.originalLanguageName || film?.tmdb?.originalLanguageName),
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
            festivalName:
              stringOrEmpty(showing?.festivalName || showing?.festival_name) ||
              festivalNameById.get(Number(showing?.festivalId ?? showing?.festival_id)) ||
              "",
            room: stringOrEmpty(showing?.room),
            notes: stringOrEmpty(showing?.notes),
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
    // Only consider a showing upcoming if we can parse the time and it's >= now
    if (minutes !== null && minutes >= nowEt.minutes) return true;
  }
  return false;
}

function prunePastShowings(film) {
  const showings = Array.isArray(film?.showings) ? film.showings : [];
  if (!showings.length) return film;

  const nowEt = getCurrentEasternDateTimeParts();
  const futureShowings = showings.filter((showing) => {
    const date = String(showing?.date || "").trim();
    const time = String(showing?.time || "").trim();
    if (!date) return false;
    if (date > nowEt.date) return true;
    if (date < nowEt.date) return false;
    const minutes = parseTimeToMinutes(time);
    // Include showing only if time is parseable and >= now
    return minutes !== null && minutes >= nowEt.minutes;
  });

  return { ...film, showings: futureShowings };
}

function getCurrentEasternDateTimeParts() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return { date, minutes };
}

const LOCATION_PIN_SVG = `<svg class="location-pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>`;

// The same location choices as the main app's #locationPickerTemplate (index.html), so they
// share its styles in css/styles.css.
const LOCATION_PICKER_MARKUP = `<div class="location-picker">
            <button class="location-device-btn" type="button" data-action="use-device-location">
              ${LOCATION_PIN_SVG}
              Use my location
            </button>
            <form class="location-zip-form" novalidate>
              <input name="zip" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="or enter a ZIP code" aria-label="ZIP code" />
              <button class="ghost-btn" type="submit">Go</button>
            </form>
            <p class="location-picker-message" role="status" aria-live="polite"></p>
          </div>`;

// With a saved location, one line and a chip that opens the pop-over; without one, a short
// prompt. Only shown when there's more than one theatre to sort.
const FILM_LOCATION_MARKUP = `<div class="film-location">
          <p id="filmLocationSorted" class="film-location-sorted" hidden>
            Nearest first from
            <button id="filmLocationChip" class="location-chip film-location-chip" type="button" popovertarget="filmLocationPopover" aria-expanded="false">
              ${LOCATION_PIN_SVG}
              <span id="filmLocationChipLabel" class="location-chip-label"></span>
            </button>
          </p>
          <div id="filmLocationPrompt" class="film-location-prompt">
            <p class="film-location-prompt-copy">Where are you watching from? We'll put the nearest theatres first.</p>
            ${LOCATION_PICKER_MARKUP}
          </div>
        </div>
        <div id="filmLocationPopover" class="location-popover" popover role="dialog" aria-labelledby="filmLocationPopoverTitle">
          <h2 id="filmLocationPopoverTitle" class="location-popover-title">Your location</h2>
          ${LOCATION_PICKER_MARKUP}
        </div>`;

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
              `<article class="show-day-card" data-date="${escapeHtml(row.date)}">
                <h3 class="show-schedule-day">${escapeHtml(formatIsoDateLabel(row.date))}</h3>
                ${row.room ? `<div class="show-room-label">Room: ${escapeHtml(row.room)}</div>` : ""}
                <div class="show-times-grid">
                  ${row.times.map((time) => renderTimeChip(time, false, row.timeNotes)).join("")}
                  ${row.premiumTimes.map((time) => renderTimeChip(time, true, row.timeNotes)).join("")}
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
            ${group.festivalNames.length
              ? `<span class="film-page-festival-ribbon">${escapeHtml(group.festivalNames.join(" · "))}</span>`
              : ""}
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
    duration: film.runtime > 0 ? `PT${Math.round(film.runtime)}M` : undefined,
    contentRating: film.certification || undefined,
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
    <link rel="apple-touch-icon" sizes="180x180" href="../../assets/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="../../assets/icons/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="../../assets/icons/favicon-16x16.png" />
    <link rel="icon" href="../../assets/icons/favicon.ico" />
    <link rel="manifest" href="../../site.webmanifest" />
    <link rel="stylesheet" href="../../css/styles.css" />
    <link rel="stylesheet" href="../../css/film-pages.css" />
    <script type="application/ld+json">${jsonForScript(pruneUndefined(ldJson))}</script>
  </head>
  <body>
    <main class="film-page-shell">
      <div class="film-page-brandbar">
        <img id="filmPageWordmark" class="film-page-wordmark" src="${escapeHtml(wordmarksLight[0] || "")}" alt="${BRAND_NAME}" />
        <img id="filmPageLogo" class="film-page-logo" src="${escapeHtml(logoDarkSrc)}" alt="" aria-hidden="true" />
      </div>
      <a class="film-page-return" href="${escapeHtml(mainAppUrl)}">&larr; All showtimes</a>
      <article class="group-card film-card film-page-card film-info-box${film.staffFavorite ? " film-card-staff-favorite" : ""}${
        film.featuredOnPlayweek ? " film-card-featured-playweek" : ""
      }">
        <h1 class="group-title group-title-film"><cite class="film-page-title">${escapeHtml(filmDisplayTitle)}</cite></h1>
        ${buildFilmMetaLineMarkup(film)}
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
              ${buildFilmFactsMarkup(film)}
            </div>
            ${tmdbMovieUrl ? `<a class="group-tmdb-link" href="${escapeHtml(tmdbMovieUrl)}" target="_blank" rel="noopener noreferrer">View on TMDb</a>` : ""}
          </div>
        </div>
      </article>

      <section class="group-card film-showtimes-box">
        <h2 class="film-showtimes-heading">Showtimes by Theatre</h2>
        ${theatreGroups.length > 1 ? FILM_LOCATION_MARKUP : ""}
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
    <script type="module">
      import {
        LOCATION_PREFERENCE_STORAGE_KEY,
        geocodeUsZip,
        haversineMiles,
        initShowtimeNoteTooltips,
      } from "../../js/shared.js";

      initShowtimeNoteTooltips();

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

        // Film pages used to keep their own location; it's still read for visitors who set one there.
        const LEGACY_LOCATION_STORAGE_KEY = "tmp-film-pages-location-v1";
        const STORAGE_KEYS = [LOCATION_PREFERENCE_STORAGE_KEY, LEGACY_LOCATION_STORAGE_KEY];
        const list = document.querySelector(".film-showtimes-box .show-list");
        let theatreItems = Array.from(document.querySelectorAll(".film-showtimes-box .show-item"));
        if (!theatreItems.length || !list) return;
        // The theatres in their current order. The masonry columns hold them column by column,
        // so the list itself can't be read back for the order.
        let orderedItems = theatreItems;
        const locationSorted = document.getElementById("filmLocationSorted");
        const locationPrompt = document.getElementById("filmLocationPrompt");
        const locationChip = document.getElementById("filmLocationChip");
        const locationChipLabel = document.getElementById("filmLocationChipLabel");
        const locationPopover = document.getElementById("filmLocationPopover");

        // Returns { mode, zip, lat, lng, place }, the main app's shape, or null.
        function readSavedLocation() {
          for (const key of STORAGE_KEYS) {
            try {
              const raw = localStorage.getItem(key);
              if (!raw) continue;
              const parsed = JSON.parse(raw);
              const lat = Number(parsed?.lat);
              const lng = Number(parsed?.lng);
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                const mode = parsed?.mode === "zip" ? "zip" : "geolocation";
                const zip = mode === "zip" ? String(parsed?.zip || "").trim() : "";
                const place = mode === "zip" ? String(parsed?.place || "").trim() : "";
                return { mode, zip, lat, lng, place };
              }
            } catch {}
          }
          return null;
        }

        // Saved in the main app's format so the Near You and Theatres views use it too.
        function saveLocation(location) {
          try {
            localStorage.setItem(LOCATION_PREFERENCE_STORAGE_KEY, JSON.stringify(location));
          } catch {}
        }

        // The ZIP's town (or the ZIP), or "My location", as on the main app's chip.
        function getLocationLabel(location) {
          if (location.mode === "zip") return location.place || location.zip || "your ZIP code";
          return "My location";
        }

        function showLocationChip(location) {
          if (!locationSorted || !locationPrompt || !locationChip || !locationChipLabel) return;
          const label = getLocationLabel(location);
          locationChipLabel.textContent = label;
          locationChip.setAttribute("aria-label", "Location: " + label + ". Change location");
          locationSorted.hidden = false;
          locationPrompt.hidden = true;
        }

        function useLocation(location) {
          if (locationPopover?.matches(":popover-open")) locationPopover.hidePopover();
          sortByDistance(location.lat, location.lng);
          showLocationChip(location);
        }

        // ZIPs saved before towns were kept have no town, so it's looked up once (the main app
        // does the same).
        async function fillInLocationPlace(location) {
          if (location.mode !== "zip" || !location.zip || location.place) return;
          const result = await geocodeUsZip(location.zip);
          if (!result?.place || readSavedLocation()?.zip !== location.zip) return;
          const updated = { ...location, place: result.place };
          saveLocation(updated);
          showLocationChip(updated);
        }

        function setLocationPickerMessage(picker, message) {
          const el = picker?.querySelector(".location-picker-message");
          if (el) el.textContent = String(message || "");
        }

        function useDeviceLocation(picker) {
          if (!navigator.geolocation) {
            setLocationPickerMessage(picker, "Location isn't supported on this device. Try a ZIP code instead.");
            return;
          }
          const button = picker.querySelector('[data-action="use-device-location"]');
          button.disabled = true;
          setLocationPickerMessage(picker, "Finding you...");
          navigator.geolocation.getCurrentPosition(
            (position) => {
              button.disabled = false;
              setLocationPickerMessage(picker, "");
              const location = {
                mode: "geolocation",
                zip: "",
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                place: "",
              };
              saveLocation(location);
              useLocation(location);
            },
            (error) => {
              button.disabled = false;
              setLocationPickerMessage(
                picker,
                error?.code === 1
                  ? "Location access is blocked for this site. Try a ZIP code instead."
                  : "Couldn't get your location. Try a ZIP code instead."
              );
            },
            { enableHighAccuracy: false, timeout: 7000, maximumAge: 5 * 60 * 1000 }
          );
        }

        async function useZipLocation(picker) {
          const form = picker.querySelector(".location-zip-form");
          const submitButton = form.querySelector('button[type="submit"]');
          const zip = String(form.elements.zip.value || "").replace(/\\s+/g, "");
          if (!/^\\d{5}(?:-\\d{4})?$/.test(zip)) {
            setLocationPickerMessage(picker, "Enter a 5-digit ZIP code, like 04101.");
            return;
          }
          submitButton.disabled = true;
          setLocationPickerMessage(picker, "Looking up that ZIP code...");
          try {
            const result = await geocodeUsZip(zip);
            if (!result) {
              setLocationPickerMessage(picker, "Couldn't find that ZIP code. Try another?");
              return;
            }
            form.reset();
            setLocationPickerMessage(picker, "");
            const location = { mode: "zip", zip, lat: result.lat, lng: result.lng, place: result.place || "" };
            saveLocation(location);
            useLocation(location);
          } finally {
            submitButton.disabled = false;
          }
        }

        // Below the chip, lined up with its left edge and kept on screen. Before the pop-over
        // opens it has no size yet, so its CSS width is assumed (full width on phones).
        function positionLocationPopover() {
          if (!locationChip || !locationPopover) return;
          const rect = locationChip.getBoundingClientRect();
          const gutter = 16;
          const viewportWidth = document.documentElement.clientWidth;
          const isPhone = window.matchMedia("(max-width: 640px)").matches;
          const width = locationPopover.offsetWidth || Math.min(isPhone ? viewportWidth : 320, viewportWidth - 2 * gutter);
          const left = Math.max(gutter, Math.min(rect.left, viewportWidth - gutter - width));
          locationPopover.style.top = Math.round(rect.bottom + 8) + "px";
          locationPopover.style.left = Math.round(left) + "px";
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
          orderedItems = items;
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

        function sortByDistance(lat, lng) {
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
        }

        // The pickers (in the prompt and the pop-over) are handled together.
        document.addEventListener("click", (event) => {
          const button = event.target.closest('[data-action="use-device-location"]');
          if (button) useDeviceLocation(button.closest(".location-picker"));
        });

        document.addEventListener("submit", (event) => {
          const form = event.target.closest(".location-zip-form");
          if (!form) return;
          event.preventDefault();
          void useZipLocation(form.closest(".location-picker"));
        });

        // The pop-over is placed before it shows, again once it has a size, and follows the
        // chip if the page scrolls.
        locationPopover?.addEventListener("beforetoggle", (event) => {
          if (event.newState === "open") positionLocationPopover();
        });

        locationPopover?.addEventListener("toggle", (event) => {
          const isOpen = event.newState === "open";
          locationChip?.classList.toggle("is-open", isOpen);
          locationChip?.setAttribute("aria-expanded", String(isOpen));
          if (isOpen) {
            positionLocationPopover();
            window.addEventListener("scroll", positionLocationPopover, { passive: true });
            window.addEventListener("resize", positionLocationPopover);
          } else {
            window.removeEventListener("scroll", positionLocationPopover);
            window.removeEventListener("resize", positionLocationPopover);
            setLocationPickerMessage(locationPopover, "");
          }
        });

        // A location set in another tab (on the main app or another film page) is used here too.
        window.addEventListener("storage", (event) => {
          if (event.key !== LOCATION_PREFERENCE_STORAGE_KEY || !theatreItems.length) return;
          const location = readSavedLocation();
          if (location) useLocation(location);
        });

        // The date ("YYYY-MM-DD") and time ("HH:MM") in Maine.
        function getEasternNow() {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).formatToParts(new Date());
          const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
          return { date: values.year + "-" + values.month + "-" + values.day, time: values.hour + ":" + values.minute };
        }

        // Pages are rebuilt about once a day, so times that have started are hidden here. Days
        // move up from "Show N more days" to keep four showing; a theatre with nothing left goes.
        // Returns true when a theatre was removed.
        function hidePastShowtimes() {
          const now = getEasternNow();
          const before = theatreItems.length;
          theatreItems = theatreItems.filter((item) => {
            item.querySelectorAll(".show-day-card[data-date]").forEach((card) => {
              const date = card.dataset.date;
              if (date > now.date) return;
              if (date === now.date) {
                card.querySelectorAll(".show-time-chip[data-time]").forEach((chip) => {
                  if (chip.dataset.time < now.time) chip.remove();
                });
              }
              if (date < now.date || !card.querySelector(".show-time-chip")) card.remove();
            });
            const schedule = item.querySelector(".show-schedule:not(.show-schedule-extra)");
            const more = item.querySelector(".show-more-days");
            const extra = more?.querySelector(".show-schedule-extra");
            while (schedule && extra?.firstElementChild && schedule.children.length < 4) {
              schedule.appendChild(extra.firstElementChild);
            }
            if (more) {
              const count = extra?.children.length || 0;
              const toggle = more.querySelector(".show-more-days-toggle");
              if (!count) more.remove();
              else if (toggle) toggle.textContent = "Show " + count + " more day" + (count === 1 ? "" : "s");
            }
            if (schedule && !schedule.children.length) {
              item.remove();
              return false;
            }
            return true;
          });
          if (!theatreItems.length) {
            document.querySelector(".film-location")?.remove();
            const empty = document.createElement("p");
            empty.className = "film-page-empty";
            empty.textContent = "No more showtimes are listed for this film. ";
            const back = document.createElement("a");
            back.href = ${jsonForScript(mainAppUrl)};
            back.textContent = "See what else is playing";
            empty.appendChild(back);
            list.replaceWith(empty);
          }
          return theatreItems.length !== before;
        }

        hidePastShowtimes();
        if (!theatreItems.length) return;

        const saved = readSavedLocation();
        if (saved) {
          useLocation(saved);
          void fillInLocationPlace(saved);
        } else {
          applyShowtimesLayout(theatreItems);
        }

        // A tab left open (or a phone woken up) catches up when it's looked at again.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState !== "visible" || !theatreItems.length) return;
          if (hidePastShowtimes() && theatreItems.length) {
            applyShowtimesLayout(orderedItems.filter((item) => theatreItems.includes(item)));
          }
        });

        let resizeTimer = null;
        window.addEventListener("resize", () => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => applyShowtimesLayout(orderedItems), 90);
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
      content="Every film on The Maine Playweek, each with its own page of showtimes and details."
    />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <link rel="apple-touch-icon" sizes="180x180" href="../assets/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="../assets/icons/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="../assets/icons/favicon-16x16.png" />
    <link rel="icon" href="../assets/icons/favicon.ico" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../css/styles.css" />
    <link rel="stylesheet" href="../css/film-pages.css" />
  </head>
  <body>
    <main class="film-index-shell">
      <div class="film-index-header">
        <h1>All Films</h1>
        <a href="../index.html">Back to Showtimes</a>
      </div>
      <p class="film-index-note">Each card opens the film's own page.</p>
      <section class="results results-masonry" data-view="films" aria-live="polite">${cards}</section>
    </main>
  </body>
</html>`;
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

function buildFilmMetaLineMarkup(film) {
  const parts = [
    film.year ? String(film.year) : "",
    film.certification,
    formatRuntime(film.runtime),
  ].filter(Boolean);
  if (!parts.length) return "";
  return `<p class="film-page-meta">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</p>`;
}

function formatRuntime(minutes) {
  const total = Math.round(Number(minutes));
  if (!Number.isFinite(total) || total <= 0) return "";
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatReleaseDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  if (!match) return String(isoDate || "").trim();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Only shown for films not originally in English.
function getOriginalLanguageLabel(film) {
  const code = String(film.originalLanguage || "").trim().toLowerCase();
  if (!code || code === "en") return "";
  if (film.originalLanguageName) return film.originalLanguageName;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
}

function buildFilmFactsMarkup(film) {
  const facts = [
    { label: "Synopsis", value: film.description, allowHtml: true },
    { label: "Director", value: film.director, allowHtml: false },
    { label: "Genres", value: film.genres.join(", "), allowHtml: false },
    { label: "Stars", value: film.stars.join(", "), allowHtml: false },
    { label: "Language", value: getOriginalLanguageLabel(film), allowHtml: false },
    { label: "Release Date", value: formatReleaseDate(film.releaseDate), allowHtml: false },
  ].filter((fact) => String(fact.value || "").trim());

  return facts
    .map(
      (fact) =>
        `<div class="film-fact"><span class="film-fact-label">${escapeHtml(
          fact.label
        )}</span><span class="film-fact-value">${fact.allowHtml ? sanitizeHtmlForSynopsis(fact.value) : escapeHtml(fact.value)}</span></div>`
    )
    .join("");
}

function sanitizeHtmlForSynopsis(value) {
  const text = String(value || "");

  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const safeTagPatterns = [
    { pattern: /&lt;b&gt;/g, replacement: "<b>" },
    { pattern: /&lt;\/b&gt;/g, replacement: "</b>" },
    { pattern: /&lt;i&gt;/g, replacement: "<i>" },
    { pattern: /&lt;\/i&gt;/g, replacement: "</i>" },
    { pattern: /&lt;em&gt;/g, replacement: "<em>" },
    { pattern: /&lt;\/em&gt;/g, replacement: "</em>" },
    { pattern: /&lt;strong&gt;/g, replacement: "<strong>" },
    { pattern: /&lt;\/strong&gt;/g, replacement: "</strong>" },
    { pattern: /&lt;br\s*\/?&gt;/g, replacement: "<br>" },
  ];

  for (const { pattern, replacement } of safeTagPatterns) {
    escaped = escaped.replace(pattern, replacement);
  }

  return escaped;
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

function buildTimeNoteKey(time, isPremium) {
  return `${String(time || "").trim()}|${isPremium ? "premium" : "standard"}`;
}

function renderTimeChip(time, isPremium, timeNotes = {}) {
  const label = isPremium ? `Premium ${escapeHtml(time)}` : escapeHtml(time);
  const className = isPremium ? "show-time-chip show-time-chip-premium" : "show-time-chip";
  const note = String(timeNotes?.[buildTimeNoteKey(time, isPremium)] || "").trim();
  // The page hides times that have started (see hidePastShowtimes); unreadable times stay.
  const hhmm = to24HourTime(time);
  const timeAttr = hhmm ? ` data-time="${hhmm}"` : "";
  if (!note) return `<span class="${className}"${timeAttr}>${label}</span>`;
  return `<span class="${className} show-time-noted"${timeAttr} tabindex="0" data-note="${escapeHtml(note)}">${label}<span class="show-note-icon" aria-hidden="true">i</span><span class="visually-hidden"> (Note: ${escapeHtml(note)})</span></span>`;
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
        festivalNamesSet: new Set(),
        latitude: Number.isFinite(Number(showing.latitude)) ? Number(showing.latitude) : undefined,
        longitude: Number.isFinite(Number(showing.longitude)) ? Number(showing.longitude) : undefined,
        byDate: new Map(),
      });
    }
    const entry = byTheatre.get(key);
    const festivalName = String(showing.festivalName || "").trim();
    if (festivalName) {
      entry.festivalNamesSet.add(festivalName);
    }
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
      byDate.set(showing.date, { room: String(showing.room || "").trim(), times: [], premiumTimes: [], timeNotes: {} });
    }
    const slot = byDate.get(showing.date);
    if (!slot.room) {
      slot.room = String(showing.room || "").trim();
    }
    if (showing.isPremium) {
      slot.premiumTimes.push(showing.time);
    } else {
      slot.times.push(showing.time);
    }
    const note = getShowtimeNote(showing.notes, showing.time);
    if (note) {
      const noteKey = buildTimeNoteKey(showing.time, showing.isPremium);
      const existing = slot.timeNotes[noteKey];
      if (!existing) {
        slot.timeNotes[noteKey] = note;
      } else if (!existing.split(" · ").includes(note)) {
        slot.timeNotes[noteKey] = `${existing} · ${note}`;
      }
    }
  }

  const grouped = Array.from(byTheatre.values()).map((entry) => {
    const schedule = Array.from(entry.byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        date,
        room: String(value?.room || "").trim(),
        times: dedupeTimes(value?.times || []),
        premiumTimes: dedupeTimes(value?.premiumTimes || []),
        timeNotes: value?.timeNotes || {},
      }));
    return {
      theatre: entry.theatre,
      city: entry.city,
      ticketLink: entry.ticketLink,
      festivalNames: Array.from(entry.festivalNamesSet.values()).sort((a, b) => a.localeCompare(b)),
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
        festivalNames: [],
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
  return Array.from(new Set((times || []).filter(Boolean))).sort(compareTimes);
}

// Minutes after midnight, or null when the time can't be parsed.
function parseTimeToMinutes(value) {
  const hhmm = to24HourTime(value);
  if (!hhmm) return null;
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
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
  return getFilmSortBreakdown({
    popularity: film?.popularity,
    voteAverage: film?.voteAverage,
    voteCount: film?.voteCount,
    releaseDate: film?.releaseDate,
    staffFavorite: film?.staffFavorite,
    upcomingTimes: countUpcomingShowings(film),
    theatreCount: countUpcomingTheatreCoverage(film),
  }).finalScore;
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
