import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET, normalizeQuery, toSearchResults } from "../api/tmdb-search.js";

const realFetch = globalThis.fetch;
const realKey = process.env.TMDB_API_KEY;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.TMDB_API_KEY;
  else process.env.TMDB_API_KEY = realKey;
});

test("normalizeQuery trims, collapses spaces and lowercases", () => {
  assert.equal(normalizeQuery("  Past   Lives "), "past lives");
  assert.equal(normalizeQuery(null), "");
});

test("toSearchResults keeps the fields the app uses", () => {
  const results = toSearchResults([
    { id: 666277, title: "Past Lives", release_date: "2023-06-02", poster_path: "/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg", overview: "Nora and Hae Sung", popularity: 40 },
    { id: 12, title: "No Date", release_date: "", poster_path: null },
    { id: 0, title: "Bad id" },
    { id: 13, title: "  " },
  ]);
  assert.deepEqual(results, [
    {
      tmdbId: 666277,
      title: "Past Lives",
      year: 2023,
      releaseDate: "2023-06-02",
      posterUrl: "https://image.tmdb.org/t/p/w342/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg",
      overview: "Nora and Hae Sung",
    },
    { tmdbId: 12, title: "No Date", year: null, releaseDate: null, posterUrl: null, overview: "" },
  ]);
  assert.deepEqual(toSearchResults(undefined), []);
});

test("GET rejects queries that are too short without calling TMDb", async () => {
  globalThis.fetch = () => assert.fail("shouldn't fetch");
  const response = await GET(new Request("https://example.com/api/tmdb-search?q=%20a%20"));
  assert.equal(response.status, 400);
});

test("GET searches TMDb with the normalized query and caches the answer", async () => {
  process.env.TMDB_API_KEY = "secret";
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url);
    return Response.json({ results: [{ id: 1, title: "Anora", release_date: "2024-10-18" }] });
  };
  const response = await GET(new Request("https://example.com/api/tmdb-search?q=ANORA%20"));
  assert.equal(response.status, 200);
  assert.equal(requested.searchParams.get("query"), "anora");
  assert.equal(requested.searchParams.get("include_adult"), "false");
  assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
  assert.deepEqual((await response.json()).results.map((r) => r.title), ["Anora"]);
});

test("GET doesn't leak the key when TMDb fails", async () => {
  process.env.TMDB_API_KEY = "secret";
  globalThis.fetch = async () => Response.json({ status_message: "Invalid API key" }, { status: 401 });
  const response = await GET(new Request("https://example.com/api/tmdb-search?q=anora"));
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes("secret"));
  assert.equal(response.headers.get("cache-control"), "no-store");
});
