// Searches TMDb by title for the iOS app's "add any film to your watchlist" screen.
// Public (no sign-in), so it only answers title searches and returns a few fields,
// and the CDN caches each query so repeated searches don't reach TMDb.

const NO_STORE = { "Cache-Control": "no-store" };
// Browsers keep a result for an hour; Vercel's CDN keeps it for a day.
const CACHED = { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" };

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 20;

export async function GET(request) {
  const query = normalizeQuery(new URL(request.url).searchParams.get("q"));
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `q must be ${MIN_QUERY_LENGTH} to ${MAX_QUERY_LENGTH} characters` },
      { status: 400, headers: NO_STORE }
    );
  }

  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  if (!apiKey) {
    return Response.json({ error: "TMDB_API_KEY isn't set on the server" }, { status: 500, headers: NO_STORE });
  }

  try {
    const response = await fetch(
      "https://api.themoviedb.org/3/search/movie" +
        `?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}` +
        "&include_adult=false&language=en-US&page=1",
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) {
      // Don't echo the key; TMDb's message is enough.
      const body = await response.json().catch(() => ({}));
      const message = body.status_message || "request failed";
      return Response.json({ error: `TMDb ${response.status}: ${message}` }, { status: 502, headers: NO_STORE });
    }
    const body = await response.json();
    return Response.json({ results: toSearchResults(body.results) }, { headers: CACHED });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502, headers: NO_STORE });
  }
}

/** Trims, collapses spaces and lowercases, so "Past  Lives" and "past lives" share a cache entry. */
export function normalizeQuery(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Keeps only what the app shows. Poster URLs match the w342 size the site stores in tmdb_json. */
export function toSearchResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .filter((movie) => Number.isInteger(movie?.id) && movie.id > 0 && String(movie.title || "").trim())
    .slice(0, MAX_RESULTS)
    .map((movie) => {
      const year = Number.parseInt(String(movie.release_date || "").slice(0, 4), 10);
      return {
        tmdbId: movie.id,
        title: String(movie.title).trim(),
        year: Number.isInteger(year) ? year : null,
        releaseDate: movie.release_date || null,
        posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null,
        overview: movie.overview || "",
      };
    });
}
