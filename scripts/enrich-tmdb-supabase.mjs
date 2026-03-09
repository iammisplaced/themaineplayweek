const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const TMDB_API_KEY = String(process.env.TMDB_API_KEY || "").trim();
const UPDATE_LIMIT = Number.parseInt(process.env.TMDB_UPDATE_LIMIT || "0", 10) || 0;
const REQUEST_DELAY_MS = Number.parseInt(process.env.TMDB_REQUEST_DELAY_MS || "250", 10) || 250;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TMDB_API_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TMDB_API_KEY");
  process.exit(1);
}

const restBase = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;

const films = await fetchAllFilms();
if (!films.length) {
  console.log("No films found.");
  process.exit(0);
}

let scanned = 0;
let updated = 0;
let skipped = 0;
let failed = 0;

for (const film of films) {
  if (UPDATE_LIMIT > 0 && scanned >= UPDATE_LIMIT) break;
  scanned += 1;

  const title = String(film.title || "").trim();
  const year = Number(film.year);
  const currentTmdbId = Number(film.tmdb_id);
  const hasTmdbId = Number.isInteger(currentTmdbId) && currentTmdbId > 0;
  const canSearchByTitle = Boolean(title) && Number.isInteger(year);

  if (!hasTmdbId && !canSearchByTitle) {
    skipped += 1;
    continue;
  }

  try {
    const details = hasTmdbId
      ? await fetchTmdbFilmDetailsById(TMDB_API_KEY, currentTmdbId, title, year)
      : await fetchTmdbFilmDetailsBySearch(TMDB_API_KEY, title, year);

    if (!details) {
      skipped += 1;
      await delay(REQUEST_DELAY_MS);
      continue;
    }

    const nextTmdbJson = {
      id: details.id,
      title: details.title,
      releaseDate: details.release_date,
      popularity: toFiniteNumber(details.popularity),
      voteAverage: toFiniteNumber(details.vote_average),
      voteCount: toFiniteNumber(details.vote_count),
      posterPath: details.poster_path || "",
      posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w342${details.poster_path}` : "",
      director: details.director,
      stars: details.stars,
      genres: details.genres,
      matchedAt: new Date().toISOString(),
    };

    const existingTmdbJson = isPlainObject(film.tmdb_json) ? film.tmdb_json : {};
    const changed =
      Number(film.tmdb_id) !== Number(details.id) || !deepEqualShallow(existingTmdbJson, nextTmdbJson);
    if (!changed) {
      skipped += 1;
      await delay(REQUEST_DELAY_MS);
      continue;
    }

    await updateFilmRow(film.id, {
      tmdb_id: details.id,
      tmdb_json: nextTmdbJson,
    });
    updated += 1;
    console.log(`Updated film ${film.id}: ${title} (${year || "n/a"}) -> TMDb ${details.id}`);
  } catch (error) {
    failed += 1;
    console.warn(`Failed film ${film.id} (${title}): ${error.message}`);
  }

  await delay(REQUEST_DELAY_MS);
}

console.log(`Done. scanned=${scanned} updated=${updated} skipped=${skipped} failed=${failed}`);
if (failed > 0) {
  process.exitCode = 1;
}

async function fetchAllFilms(pageSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const url = `${restBase}/films?select=id,title,year,tmdb_id,tmdb_json&order=id.asc`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Range: `${from}-${to}`,
        Prefer: "count=none",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase fetch films failed (${response.status}): ${text}`);
    }

    const chunk = await response.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function updateFilmRow(filmId, payload) {
  const url = `${restBase}/films?id=eq.${encodeURIComponent(String(filmId))}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase update failed (${response.status}): ${text}`);
  }
}

async function fetchTmdbFilmDetailsBySearch(apiKey, title, year) {
  const params = new URLSearchParams({
    api_key: apiKey,
    query: title,
    year: String(year),
    include_adult: "false",
  });

  const searchUrl = `https://api.themoviedb.org/3/search/movie?${params.toString()}`;
  const searchJson = await fetchJson(searchUrl);
  const results = Array.isArray(searchJson.results) ? searchJson.results : [];
  if (!results.length) return null;

  const best = pickBestResult(results, title, year);
  return fetchTmdbFilmDetailsById(apiKey, Number(best.id), title, year);
}

async function fetchTmdbFilmDetailsById(apiKey, tmdbId, fallbackTitle = "", fallbackYear = NaN) {
  try {
    return await fetchMovieDetailsById(apiKey, tmdbId, fallbackTitle);
  } catch (error) {
    if (String(error.message).includes("(404)")) {
      if (fallbackTitle && Number.isInteger(fallbackYear)) {
        return fetchTmdbFilmDetailsBySearch(apiKey, fallbackTitle, fallbackYear);
      }
      return null;
    }
    throw error;
  }
}

async function fetchMovieDetailsById(apiKey, movieId, fallbackTitle = "") {
  const detailsUrl =
    `https://api.themoviedb.org/3/movie/${encodeURIComponent(String(movieId))}` +
    `?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`;
  const details = await fetchJson(detailsUrl);

  const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
  const cast = Array.isArray(details.credits?.cast) ? details.credits.cast : [];
  const director = crew.find((member) => member.job === "Director")?.name || "";
  const stars = cast.slice(0, 3).map((member) => member.name).filter(Boolean);
  const genres = Array.isArray(details.genres) ? details.genres.map((genre) => genre.name).filter(Boolean) : [];

  return {
    id: details.id,
    title: details.title || fallbackTitle,
    release_date: details.release_date || "",
    popularity: toFiniteNumber(details.popularity),
    vote_average: toFiniteNumber(details.vote_average),
    vote_count: toFiniteNumber(details.vote_count),
    poster_path: details.poster_path || "",
    director,
    stars,
    genres,
  };
}

function pickBestResult(results, title, year) {
  const normalizedTitle = String(title || "").toLowerCase();
  const exactTitleAndYear = results.find(
    (result) =>
      String(result.title || "").toLowerCase() === normalizedTitle &&
      getReleaseYear(result.release_date) === Number(year)
  );
  if (exactTitleAndYear) return exactTitleAndYear;

  const exactYear = results.find((result) => getReleaseYear(result.release_date) === Number(year));
  return exactYear || results[0];
}

function getReleaseYear(releaseDate) {
  if (typeof releaseDate !== "string" || releaseDate.length < 4) return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TMDb request failed (${response.status}): ${text}`);
  }
  return response.json();
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepEqualShallow(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
