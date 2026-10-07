# Showtimes Scraper Guide

Scrapers that pull the next 7 days of showtimes from a theatre chain's website and save a CSV ready for the admin **Import CSV** feature.

| Chain | Command | Prompts for | Output file |
| --- | --- | --- | --- |
| Regal Cinemas | `node scripts/scrape-showtimes.mjs` | theatre URL, name, city, fetch years | `scraped-{city}-showtimes.csv` |
| Apple Cinemas | `node scripts/scrape-apple-cinema.mjs` | theatre URL, name, city, fetch years | `scraped-{city}-apple-showtimes.csv` |
| Flagship Cinemas | `node scripts/scrape-flagship.mjs [--city=Auburn\|Falmouth\|Thomaston\|Waterville\|Wells\|all] [--days=7]` | city, unless `--city` is passed | `scraped-{city}-flagship-showtimes.csv` |
| Smitty's Entertainment | `node scripts/scrape-smittys.mjs [--city=Sanford\|Topsham\|all] [--days=7]` | city, unless `--city` is passed | `scraped-{city}-smittys-showtimes.csv` |

Run `npm install` once first (Puppeteer, used by the Regal and Apple scrapers; Flagship and Smitty's need no browser). Browser launch, paced/retrying requests, prompts and CSV formatting are shared in `scripts/lib/scraper-utils.mjs`.

## Output

Every scraper writes the same columns as the admin CSV template (see README):
- `theatre_name`, `theatre_city` - what you entered (Flagship always uses `Flagship Cinemas` and Smitty's `Smitty's Entertainment`, with the city telling theatres apart)
- `film_title` - movie title as listed by the theatre
- `show_date` - `YYYY-MM-DD`
- `show_times` - pipe-separated, one row per film per date, duplicates removed (e.g. `12:30PM|3:20PM|6:00PM`)
- `premium_show_times` - Flagship only: 3D showings go here instead of `show_times`
- `film_year` - filled by Flagship (release year from its API) and by Regal when year lookup runs; the Apple prompt doesn't do anything yet, and Smitty's doesn't ask
- `film_tmdb_id` - filled by Flagship only
- everything else is left blank for you to fill in

## Finding theatre URLs

- **Regal**: go to https://www.regmovies.com/theatres, open your theatre and copy its URL (`/theatres/regal-{city}-{id}`), e.g. `https://www.regmovies.com/theatres/regal-augusta-1704`.
- **Apple Cinemas**: go to https://www.applecinemas.com/locations, open your theatre and copy its URL (`/home/{theatre-id}`), e.g. `https://www.applecinemas.com/home/611fea26f74bab2423301ee4`.
- **Flagship**: no URL needed. Auburn, Falmouth, Thomaston, Waterville and Wells are built in.
- **Smitty's**: no URL needed. Sanford and Topsham are built in (Windham is closed).

## How each scraper works

**Regal** loads the theatre page, then clicks through the date buttons one day at a time and reads every film and showtime. It stops early if a day comes back empty or exactly matches the previous day, which means date navigation failed. With year lookup on, it opens each film's page once to read the release year (~5-10 min instead of ~1-2).

**Apple Cinemas** goes through each NOW PLAYING film:
1. Clicks the film, then handles any confirmation modal (Yes/OK) and the location modal (clicks your city; if your city isn't listed, the film has no showtimes there and is skipped).
2. Reads the times for the date the page opens on. This is the soonest showtime, which isn't always today.
3. Steps through the date picker. It stops when a date opens a modal or has no data.

**Flagship** doesn't use a browser either. `[city].flagshipcinemas.com` redirects to `flagshipcinemas.com/[city]`, an INDY Systems app that loads everything from a public GraphQL API at `flagshipcinemas.com/graphql` (it needs a `circuit-id: 83` header). The scraper:
1. Calls the same startup config the site requests on every page load, to get the site ID for each city (Auburn 338, Falmouth 339, Thomaston 340, Waterville 341, Wells 342) and the ID of the `3D` badge.
2. For each theatre and day, calls `showingsForDate(date, siteIds)`.
3. Skips unpublished and private showings, converts the UTC timestamps to Eastern time, and files each showing under its Eastern date.
4. Fills `film_year` and `film_tmdb_id` from the movie data, and puts showings with the 3D badge in `premium_show_times`.

All five theatres take about 30 seconds (35 requests).

**Smitty's** (Theater Toolkit site) doesn't use a browser. It downloads the location page to get the movie list, then each movie page. Every movie page contains an `ld+json` list of `screeningEvent`s with the full upcoming schedule at that location (`"StartDate": "Tuesday, October 6, 2026 6:30 PM"`), and that list is the data source. If a page's list is missing or won't parse, the scraper falls back to the endpoint the date picker uses (`/theater/movietimes?locationKey=…&featureName=…&day=M/D/YYYY`) and logs a warning. Only the next `--days` days (default 7) are kept. Requests are spaced 400 ms apart because the site returns 403 when hit too fast; 403, 429 and 5xx responses are retried after 5 s and then 15 s (all fetch-based scrapers do this). Both cities take about 20 seconds.

## Import to the app

1. Open the admin panel.
2. **Import CSV** and choose the file.
3. **Save All Changes**.

## Troubleshooting

- **No showtimes extracted**: check the theatre URL, or for Smitty's, the city spelling.
- **Apple: "location not found" for a film**: that film isn't playing at your theatre.
- **Regal: "Same movies as previous day!"**: the site's date buttons changed. The selector is in `clickDateButton` in `scrape-showtimes.mjs`.
- **Flagship: "GraphQL error"**: the API's schema changed. Compare `SHOWINGS_QUERY` in `scrape-flagship.mjs` with the `showingsForDate` request the site makes (browser dev tools, Network tab, filter `graphql`).
- **Flagship: "site for X not found"**: Flagship renamed or closed that theatre.
- **Smitty's: "HTTP 403, retrying"**: the site is rate-limiting. Wait a few minutes and run again.
- **Smitty's: "no ld+json screening list"**: the site changed its markup. The fallback still works, but check `extractFromLdJson`.
