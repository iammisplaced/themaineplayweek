// Test environment settings. Only files under test/ read this.
//
// Supabase is intentionally left blank: with no URL/key the test app never
// talks to the production database and runs on the local JSON snapshot in
// test/data/ plus browser localStorage drafts.
//
// When the test Supabase project exists, paste its URL and anon key here.
// Never put the production project (rjfsjoratsfqcyyjseqm) here.
export const ENV_NAME = "test";
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";

// Prefix for every localStorage key so test drafts never mix with the
// production site's drafts when both are served from the same origin.
export const STORAGE_PREFIX = "tmp-test:";

const PRODUCTION_SUPABASE_REF = "rjfsjoratsfqcyyjseqm";
if (SUPABASE_URL.includes(PRODUCTION_SUPABASE_REF)) {
  throw new Error("test/js/env.js points at the production Supabase project. Use the test project instead.");
}
