# The Maine Playweek

The Maine Playweek is a showtimes website for movie theatres in Maine. Visitors can see what's playing near them, browse by theatre or by film, and find festival screenings. Each film also has its own static page for search engines and sharing.

It's a plain static site (HTML, CSS and JavaScript, with no build step) that reads its data from [Supabase](https://supabase.com). Showtimes go in through an admin panel built into the site, usually by importing a CSV produced by the scrapers in `scripts/`.

## How it fits together

```
 theatre websites ──(npm run scrape)──> scraped-all-showtimes.csv
                                                │
                                      Admin panel: Import CSV, Save All Changes
                                                ▼
 TMDb ──(daily GitHub Action)──────────>   Supabase   <── admin edits (films, theatres, promos, festivals)
                                                │
                     ┌──────────────────────────┴───────────────────────────┐
                     ▼                                                      ▼
   index.html reads it live in the browser             daily GitHub Action regenerates films/
                                                        (static film pages), commits to main
```

- **Supabase is the source of truth.** The site loads everything from it on every visit, and the admin panel writes back to it.
- **Pushing to `main` deploys the site.** Vercel serves it at <https://showtimes.themaineplayweek.com>, and GitHub Pages also publishes the root of `main` (<https://iammisplaced.github.io/themaineplayweek/>).
- **Two GitHub Actions run every morning** (times are UTC). At 09:25 one refreshes film metadata from TMDb, and at 09:40 the other rebuilds the static film pages in `films/` and commits them to `main`. Because of that bot commit, pull before you push.

## What's in the repo

| Path | What it is |
| --- | --- |
| `index.html`, `css/styles.css`, `js/app.js` | The site: the public views plus the admin panel |
| `js/shared.js` | Helpers shared by the site and the scripts: Supabase URL and public key, dates and times, film slugs and ranking, showtime notes |
| `js/map-view.js` | The theatre map in the Near You view |
| `admin-films.html`, `css/admin-films.css`, `js/admin-films.js` | Admin film catalog page (staff favourites, featured films, ranking overrides) |
| `films/` | Static film pages, **generated; don't edit by hand** |
| `data/film-pages-source.live.json` | Snapshot of the Supabase data used for the last film-page build (generated); also the site's offline fallback |
| `data/film-pages-source.json` | Sample input for building film pages without Supabase |
| `supabase/schema.sql` | Database tables, security policies and save functions |
| `scripts/scrape-*.mjs`, `scripts/lib/scraper-utils.mjs` | Showtime scrapers (see `SCRAPER_GUIDE.md`) |
| `scripts/generate-film-pages.mjs` | Builds `films/` |
| `scripts/enrich-tmdb-supabase.mjs` | Fills film metadata in Supabase from TMDb (run by the daily Action) |
| `.github/workflows/` | The two daily Actions |
| `assets/`, `site.webmanifest` | Icons, logos and images |

## Running it locally

Any static file server works:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. The local site reads and writes the **live** Supabase database, so changes you save locally are real.

The scripts need Node (version 24, see `.nvmrc`). Run `npm install` once.

## The site

Visitors get four views, and the site remembers the one they used last:

- **Near You** (beta): showtimes by day, nearest theatres first, with a day picker and an optional map. It asks for a location once and remembers it.
- **Theatres**: each theatre with its films and times.
- **All Films**: every film, ranked, with times at every theatre.
- **Festivals**: festival line-ups.

Showtimes that have already passed are hidden automatically. Premium showings show as a "Premium 7:00 PM" pill, and any showtime with a note shows it on hover or tap.

## Admin

Click **Admin** at the bottom of the site and sign in with a magic link. Enter your email, click the link in the email, and you're back on the site, signed in. Admin accounts are Supabase Auth users.

Nothing is written to Supabase until you click **Save All Changes**. Until then, edits only live in your browser.

What you can do in the panel:

- **Theatre and film:** search for and select a theatre and film. **+ Add Theatre** and **+ Add Film** create new ones (a new film is added at every theatre). **Delete Film** removes one.
- **Ticket link:** set per theatre and film.
- **Film details:** **Refresh TMDb** pulls the selected film's poster, director, cast, genres, runtime, rating and synopsis from TMDb. It needs the film's TMDb ID and a TMDb API key, which you paste into the panel once (it's kept in your browser only). **Edit Film Metadata** sets those details by hand for films that aren't on TMDb, or overrides TMDb.
- **Showings:** pick a date (and optionally a number of days to repeat it), then enter times, premium times, a room, a festival and a note.
- **Import CSV / Download CSV Template:** bulk-add showtimes (format below).
- **Promos:** the promo cards shown on the site.
- **Festivals:** create festivals, then attach showings to them.
- **Open Film Catalog:** goes to `admin-films.html`, which lists every film so you can mark staff favourites, feature films on the Playweek, and override the ranking.

## Getting showtimes in

The scrapers do most of the work. `npm run scrape` scrapes every Flagship, Smitty's, Regal and Apple Cinemas theatre and writes one file, `scraped-all-showtimes.csv`. Import that file in the admin panel, then click **Save All Changes**. `SCRAPER_GUIDE.md` covers options, how each scraper works, and troubleshooting.

### CSV import format

Required columns:
- `theatre_name`
- `theatre_city`
- `film_title`
- `show_date` (`YYYY-MM-DD`)
- `show_times` and/or `premium_show_times`: times as `h:mm AM/PM`, separated by `|`, `,` or `;`

Optional columns:
- `film_year`, `film_tmdb_id`: tell films with the same title apart
- `room`: a room or screen label, e.g. `Main Hall`
- `notes`: shown when a visitor hovers or taps a showtime. Target specific times with a time prefix and separate entries with `;`, for example `7:00 PM: Q&A with director; 9:30 PM: Open captions`. Text without a time prefix applies to every time that day. Prefix times don't need to match exactly (`7pm` matches `7:00 PM`).
- `festival_name`: must match an existing festival
- `ticket_link`

How rows are matched and merged:
- The theatre must already exist. It's matched on `theatre_name` + `theatre_city`, ignoring case.
- The film is matched by title, ignoring case and punctuation (`Spider-Man` matches `spider man`), and narrowed by `film_year` or `film_tmdb_id` when given. If there's no match, the film is created at that theatre. A row with `film_tmdb_id` only matches a film with that exact TMDb ID, so a film saved without one gets a duplicate.
- Times are added to any showings already saved for that date, and duplicates are dropped.
- A blank `ticket_link` or `notes` keeps what's saved. Non-blank notes are **merged** into the saved note (entries it doesn't already have are added), so re-importing scraped notes keeps hand-written ones. A lone `-` clears the note.

Example:

```csv
theatre_name,theatre_city,film_title,show_date,show_times,premium_show_times,room,notes,festival_name,ticket_link
Nickelodeon Cinema,Portland,Anora,2026-03-12,6:30 PM|9:15 PM,,Main Hall,9:15 PM: Q&A with director,Portland Film Festival,https://tickets.example.com/anora
Apple Cinemas,Saco,Digger,2026-03-13,1:00 PM,3:00 PM|6:00 PM,,3:00 PM: IMAX; 6:00 PM: IMAX,,
```

## Static film pages

`scripts/generate-film-pages.mjs` builds one page per film (`films/<slug>/index.html`), an index page (`films/index.html`) and their stylesheet (`films/film-pages.css`). The daily Action does this from Supabase. To build them yourself:

```bash
npm run film-pages:build   # from data/film-pages-source.json
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run film-pages:live   # from Supabase
```

Options: `--input=...`, `--out=films`, `--site-url=https://showtimes.themaineplayweek.com` (makes the canonical and share links absolute), `--from-supabase`, `--supabase-url=...`/`--supabase-anon-key=...` (or the env vars), and `--write-source=...` (saves a snapshot of the data used). The input can be `{ "films": [...] }` or the app's `{ "theatreGroups": [...] }` shape.

Usually you don't need to run this: commit your other changes and let the Action rebuild `films/`.

## GitHub Actions

| Workflow | When | What it does | Secrets it needs |
| --- | --- | --- | --- |
| `tmdb-supabase-refresh.yml` | Daily at 09:25 UTC, or run by hand | Updates every film's TMDb details in Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_KEY` |
| `film-pages-supabase-sync.yml` | Daily at 09:40 UTC, or run by hand | Rebuilds `films/` and commits it to `main` if anything changed | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL` |

Set the secrets under the repository's **Settings → Secrets and variables → Actions**. To run one now, open the **Actions** tab, pick the workflow, and click **Run workflow**.

## Supabase

The Supabase URL and anon key are in `js/shared.js`. The anon key is meant to be public, and the security policies in `schema.sql` limit what it can do. The service role key bypasses those policies, so it only ever goes in GitHub secrets, never in the repo.

**Setting up a new project:**
1. In the Supabase SQL editor, run `supabase/schema.sql`.
2. Under Auth, enable the Email provider with magic links, and set the site URL to the deployed site (or your local URL while testing).
3. Add an admin user under Auth.
4. Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/shared.js`, and the GitHub secrets.

**After `schema.sql` changes**, run it again in the SQL editor. It's written to be re-run safely: it creates what's missing and replaces the functions. If saving fails with `DELETE requires a WHERE clause`, the save function is out of date, and re-running the file fixes it.

Main tables: `theatres`, `films`, `showings` (one row per theatre, film and date, with `times`, `premium_times`, `room`, `notes` and `festival_id`), `theatre_films` (ticket links only), `festivals`, `festival_films` and `promos`.

## Data shape in the app

This is what `js/app.js` works with after loading from Supabase. It's also the `{ "theatreGroups": [...] }` input the film-page generator accepts.

```json
{
  "theatreGroups": [
    {
      "name": "Apple Cinemas",
      "city": "Saco",
      "address": "779 Portland Rd, Saco, ME 04072",
      "website": "https://www.applecinemas.com",
      "films": [
        {
          "title": "Digger",
          "year": 2026,
          "tmdbId": 12345,
          "ticketLink": "https://tickets.example.com/digger",
          "tmdb": { "posterUrl": "https://image.tmdb.org/t/p/w342/abc.jpg", "director": "…", "stars": ["…"], "genres": ["Drama"] },
          "showings": [
            {
              "date": "2026-10-07",
              "times": ["1:00 PM", "4:00 PM"],
              "premiumTimes": ["3:00 PM"],
              "notes": "3:00 PM: IMAX",
              "room": "",
              "festivalId": null
            }
          ]
        }
      ]
    }
  ],
  "festivals": []
}
```

If Supabase can't be reached, the site falls back to the last copy it saved in the browser (`localStorage`), then to the film-page data (`data/film-pages-source.live.json`, then `data/film-pages-source.json`).
