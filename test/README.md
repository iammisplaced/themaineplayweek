# Test environment

A sandboxed copy of the site for trying changes safely. Everything **outside**
`test/` is production and is not modified by work done here.

## Run it

From the repo root:

```bash
python3 -m http.server 8080
```

- Test site: <http://localhost:8080/test/>
- Test admin film catalog: <http://localhost:8080/test/admin-films.html>
- Production (for comparison): <http://localhost:8080/>

## How it differs from production

| | Production (repo root) | Test (`test/`) |
|---|---|---|
| Database | Production Supabase project | None yet — Supabase disabled (`test/js/env.js`) |
| Data | Live Supabase, fallback to `data/` | Local snapshot in `test/data/` |
| Browser storage | Plain keys (`tmp-theme`, …) | Prefixed `tmp-test:` so drafts never mix |
| Analytics | Google Analytics | Removed |
| Search engines | Indexed | `noindex, nofollow` |
| Look | Normal | Red "TEST ENVIRONMENT" banner, `[TEST]` titles |

Admin "Save All Changes" and the admin film catalog need a database, so they
are inactive here until the test Supabase project exists.

## What's in here

- `index.html`, `admin-films.html`, `site.webmanifest` — copies of the production pages, relabeled
- `css/`, `js/` — copies of production styles and scripts
- `js/env.js` — **the one place** test settings live (Supabase URL/key, storage prefix)
- `data/` — snapshot of `data/film-pages-source*.json` used as test data
- `assets`, `films` — symlinks to the production folders (read-only use, avoids duplicating ~12 MB)

The scheduled GitHub Actions only write to the production `films/` and `data/`
folders; they do not touch `test/`, so the test snapshot stays stable.

## Next step: a test Supabase database

1. Create a new Supabase project (e.g. "themaineplayweek-test").
2. In its SQL editor, run the production `supabase/schema.sql`.
3. Enable Email + Magic Link auth; set the site URL to `http://localhost:8080/test/`.
4. Paste the new project's URL and anon key into `test/js/env.js`.

`env.js` refuses to start if it is ever pointed at the production project.

## Promoting a change to production

Make and verify the change under `test/`, then apply the same edit to the
matching production file (e.g. `test/js/app.js` → `js/app.js`). Keep the
test-only differences (the `env.js` import, storage prefix, banner, no
analytics) out of production.
