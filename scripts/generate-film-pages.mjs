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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const source = fromSupabase ? await loadFilmSourceFromSupabase() : JSON.parse(await fs.readFile(inputPath, "utf8"));
  const films = normalizeFilms(source);

  if (!films.length) {
    const sourceLabel = fromSupabase ? "Supabase" : inputPath;
    throw new Error(`No films found in ${sourceLabel}`);
  }

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

  if (writeSourcePath) {
    await fs.mkdir(path.dirname(writeSourcePath), { recursive: true });
    await fs.writeFile(writeSourcePath, JSON.stringify(source, null, 2), "utf8");
    console.log(`Wrote source snapshot to ${path.relative(cwd, writeSourcePath)}`);
  }

  console.log(`Generated ${pageItems.length} film pages at ${path.relative(cwd, outputDir)}`);
}

async function loadFilmSourceFromSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase config. Pass --supabase-url/--supabase-anon-key or set SUPABASE_URL and SUPABASE_ANON_KEY."
    );
  }

  const restBase = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
  const [theatres, films, showings] = await Promise.all([
    fetchAllFromSupabase(restBase, supabaseAnonKey, "theatres", "id,name,city,address,website"),
    fetchAllFromSupabase(restBase, supabaseAnonKey, "films", "id,title,year,tmdb_id,synopsis,tmdb_json"),
    fetchAllFromSupabase(restBase, supabaseAnonKey, "showings", "theatre_id,film_id,show_date,times"),
  ]);

  const theatreById = new Map();
  theatres.forEach((row) => {
    theatreById.set(String(row.id), {
      name: String(row.name || "").trim(),
      city: String(row.city || "").trim(),
    });
  });

  const filmById = new Map();
  films.forEach((row) => {
    const tmdb = isPlainObject(row.tmdb_json) ? row.tmdb_json : {};
    filmById.set(String(row.id), {
      title: String(row.title || "").trim(),
      year: toNumber(row.year),
      tmdbId: row.tmdb_id ? String(row.tmdb_id) : "",
      description: String(tmdb.overview || row.synopsis || "").trim(),
      posterUrl: normalizeSupabasePosterUrl(tmdb.posterUrl || tmdb.poster_path || ""),
      director: String(tmdb.director || "").trim(),
      genres: Array.isArray(tmdb.genres) ? tmdb.genres.filter(Boolean) : [],
      stars: Array.isArray(tmdb.stars) ? tmdb.stars.filter(Boolean) : [],
      releaseDate: String(tmdb.releaseDate || "").trim(),
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
    const times = Array.isArray(row.times) ? row.times : [];
    times.forEach((time) => {
      const timeValue = String(time || "").trim();
      if (!date || !timeValue) return;
      film.showings.push({
        date,
        time: timeValue,
        theatre: theatre.name || theatreLabel || "Theatre TBA",
      });
    });
  });

  const sourceFilms = Array.from(filmById.values()).filter((film) => film.title);
  return { films: sourceFilms };
}

async function fetchAllFromSupabase(restBase, apiKey, table, select, pageSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const url =
      `${restBase}/${encodeURIComponent(table)}?select=${encodeURIComponent(select)}` +
      `&order=id.asc`;
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
            film.showings.push({ date, time, theatre: theatreName });
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
    slug: stringOrEmpty(film?.slug),
    description: stringOrEmpty(film?.description),
    posterUrl: stringOrEmpty(film?.posterUrl),
    director: stringOrEmpty(film?.director),
    genres: Array.isArray(film?.genres) ? film.genres.filter(Boolean) : [],
    stars: Array.isArray(film?.stars) ? film.stars.filter(Boolean) : [],
    releaseDate: stringOrEmpty(film?.releaseDate),
    theatres: Array.isArray(film?.theatres) ? film.theatres.filter(Boolean) : [],
    showings: Array.isArray(film?.showings)
      ? film.showings
          .map((showing) => ({
            date: stringOrEmpty(showing?.date),
            time: stringOrEmpty(showing?.time),
            theatre: stringOrEmpty(showing?.theatre),
          }))
          .filter((showing) => showing.date && showing.time)
      : [],
  };
}

function renderFilmPage(film, slug, siteUrl) {
  const filmTitle = [film.title, film.year].filter(Boolean).join(" ");
  const description =
    film.description ||
    `${film.title} showtimes, theatres, and details from ${BRAND_NAME}.`;
  const canonicalPath = `films/${slug}/`;
  const canonicalUrl = siteUrl ? `${siteUrl}${canonicalPath}` : canonicalPath;
  const posterUrl = resolveRelativeAssetPath(film.posterUrl || DEFAULT_NO_POSTER, 2);
  const theatreGroups = buildShowtimesByTheatre(film);
  const theatreRowsMarkup = theatreGroups
    .map((group) => {
      const scheduleMarkup = group.schedule.length
        ? group.schedule
            .map(
              (row) =>
                `<div class="show-schedule-row"><span class="show-schedule-day">${escapeHtml(
                  formatIsoDateLabel(row.date)
                )}</span><span class="show-schedule-times">${escapeHtml(row.times.join(", "))}</span></div>`
            )
            .join("")
        : `<div class="show-schedule-row"><span class="show-schedule-times">Showtimes pending</span></div>`;

      return `<li class="show-item">
        <div class="show-row">
          <div>
            <div class="show-main">${escapeHtml(group.theatre)}</div>
            <div class="show-schedule">${scheduleMarkup}</div>
          </div>
        </div>
      </li>`;
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
      .film-page-top {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.6rem;
        margin: 0 0 0.8rem;
      }
      .film-page-top a {
        color: var(--accent-2);
        font-weight: 700;
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
      .film-page-card .group-film-poster {
        width: 104px;
        height: 156px;
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
    </style>
    <script type="application/ld+json">${jsonForScript(pruneUndefined(ldJson))}</script>
  </head>
  <body>
    <main class="film-page-shell">
      <div class="film-page-top">
        <a class="back-link" href="../">All Films</a>
        <p class="film-page-note">Prototype: static SEO detail page</p>
      </div>
      <article class="group-card film-card film-page-card film-info-box">
        <h1 class="group-title group-title-film">${escapeHtml(filmTitle)}</h1>
        <div class="group-film-summary">
          <img class="group-film-poster" src="${escapeHtml(posterUrl)}" alt="Poster for ${escapeHtml(filmTitle)}" loading="lazy" />
          <div class="group-film-details">
            <div class="group-film-facts film-page-facts">
              ${buildFilmFactsMarkup(film, description)}
            </div>
          </div>
        </div>
      </article>

      <section class="group-card film-showtimes-box">
        <h2 class="film-showtimes-heading">Showtimes by Theatre</h2>
        ${
          theatreRowsMarkup
            ? `<ul class="show-list">${theatreRowsMarkup}</ul>`
            : `<p class="film-page-empty">Showtimes not published yet.</p>`
        }
      </section>
    </main>
  </body>
</html>`;
}

function renderIndexPage(items, siteUrl) {
  const canonicalPath = "films/";
  const canonicalUrl = siteUrl ? `${siteUrl}${canonicalPath}` : canonicalPath;
  const cards = items
    .map(({ film, slug }) => {
      const title = [film.title, film.year].filter(Boolean).join(" ");
      const description =
        film.description || `${film.title} showtimes and details from ${BRAND_NAME}.`;
      const poster = resolveRelativeAssetPath(film.posterUrl || DEFAULT_NO_POSTER, 1);
      return `<article class="group-card film-card film-card-collapsed">
  <h2 class="group-title group-title-film">${escapeHtml(title)}</h2>
  <a class="film-expand-toggle film-page-link" href="./${slug}/" aria-label="View page for ${escapeHtml(title)}">View Film Page</a>
  <div class="group-film-summary">
    <img class="group-film-poster" src="${escapeHtml(poster)}" alt="Poster for ${escapeHtml(title)}" loading="lazy" />
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

function buildShowtimesByTheatre(film) {
  const byTheatre = new Map();

  for (const showing of film.showings || []) {
    const theatre = showing.theatre || "Theatre TBA";
    if (!byTheatre.has(theatre)) {
      byTheatre.set(theatre, new Map());
    }
    const byDate = byTheatre.get(theatre);
    if (!byDate.has(showing.date)) {
      byDate.set(showing.date, []);
    }
    byDate.get(showing.date).push(showing.time);
  }

  const grouped = Array.from(byTheatre.entries()).map(([theatre, dates]) => {
    const schedule = Array.from(dates.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, times]) => ({
        date,
        times: dedupeTimes(times),
      }));
    return { theatre, schedule };
  });

  if (!grouped.length && Array.isArray(film.theatres) && film.theatres.length) {
    return film.theatres.map((theatre) => ({ theatre, schedule: [] }));
  }

  return grouped.sort((a, b) => a.theatre.localeCompare(b.theatre));
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

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
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
