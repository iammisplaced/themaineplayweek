import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] || "data/showtimes.json";
const apiKey = process.env.TMDB_API_KEY;

if (!apiKey) {
  console.error("Missing TMDB_API_KEY environment variable.");
  process.exit(1);
}

const raw = await readFile(inputPath, "utf8");
const data = JSON.parse(raw);

if (!data || !Array.isArray(data.theatreGroups)) {
  throw new Error("Expected object with theatreGroups array.");
}

const cache = new Map();

for (const theatre of data.theatreGroups) {
  if (!Array.isArray(theatre.films)) continue;

  for (const film of theatre.films) {
    const title = String(film.title || "").trim();
    const year = Number(film.year);
    const tmdbId = Number(film.tmdbId);
    const hasTmdbId = Number.isInteger(tmdbId) && tmdbId > 0;
    const hasSearchInput = Boolean(title) && Number.isInteger(year);
    if (!hasTmdbId && !hasSearchInput) continue;

    const cacheKey = hasTmdbId ? `id::${tmdbId}` : `${title}::${year}`;
    if (!cache.has(cacheKey)) {
      const details = hasTmdbId
        ? await fetchTmdbFilmDetailsById(apiKey, tmdbId, title, year)
        : await fetchTmdbFilmDetails(apiKey, title, year);
      cache.set(cacheKey, details);
    }

    const details = cache.get(cacheKey);
    if (!details) continue;

    film.tmdbId = details.id;

    film.tmdb = {
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
  }
}

await writeFile(inputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`Updated ${inputPath} with TMDb metadata.`);

async function fetchTmdbFilmDetails(key, title, year) {
  const params = new URLSearchParams({
    api_key: key,
    query: title,
    year: String(year),
    include_adult: "false",
  });

  const searchUrl = `https://api.themoviedb.org/3/search/movie?${params.toString()}`;
  const searchJson = await fetchJson(searchUrl);
  const results = Array.isArray(searchJson.results) ? searchJson.results : [];
  if (!results.length) {
    console.warn(`No TMDb match for: ${title} (${year})`);
    return null;
  }

  const best = pickBestResult(results, title, year);
  const detailsUrl = `https://api.themoviedb.org/3/movie/${best.id}?api_key=${encodeURIComponent(key)}&append_to_response=credits`;
  const details = await fetchJson(detailsUrl);

  const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
  const cast = Array.isArray(details.credits?.cast) ? details.credits.cast : [];

  const director = crew.find((member) => member.job === "Director")?.name || "";
  const stars = cast.slice(0, 3).map((member) => member.name).filter(Boolean);
  const genres = Array.isArray(details.genres) ? details.genres.map((genre) => genre.name).filter(Boolean) : [];

  return {
    id: details.id,
    title: details.title || best.title || title,
    release_date: details.release_date || best.release_date || "",
    popularity: toFiniteNumber(details.popularity || best.popularity),
    vote_average: toFiniteNumber(details.vote_average || best.vote_average),
    vote_count: toFiniteNumber(details.vote_count || best.vote_count),
    poster_path: details.poster_path || best.poster_path || "",
    director,
    stars,
    genres,
  };
}

async function fetchTmdbFilmDetailsById(key, tmdbId, fallbackTitle = "", fallbackYear = NaN) {
  try {
    return await fetchMovieDetailsById(key, tmdbId, fallbackTitle);
  } catch (error) {
    if (String(error.message).includes("(404)")) {
      console.warn(`TMDb id ${tmdbId} not found. Falling back to title/year lookup.`);
      if (fallbackTitle && Number.isInteger(fallbackYear)) {
        return fetchTmdbFilmDetails(key, fallbackTitle, fallbackYear);
      }
      return null;
    }
    throw error;
  }
}

async function fetchMovieDetailsById(key, movieId, fallbackTitle = "") {
  const detailsUrl = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${encodeURIComponent(key)}&append_to_response=credits`;
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
  const normalizedTitle = title.toLowerCase();
  const exactYear = results.find((result) => getReleaseYear(result.release_date) === year);
  const exactTitleAndYear = results.find(
    (result) => (result.title || "").toLowerCase() === normalizedTitle && getReleaseYear(result.release_date) === year
  );
  return exactTitleAndYear || exactYear || results[0];
}

function getReleaseYear(releaseDate) {
  if (typeof releaseDate !== "string" || releaseDate.length < 4) return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

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
