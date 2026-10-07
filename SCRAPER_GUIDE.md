# Showtimes Scraper Guide

Scrapers that pull showtimes from theatre chains' websites and save CSVs ready for the admin **Import CSV** feature.

## Quick start

Run `npm install` once, then:

```bash
npm run scrape
```

It asks for an end date (leave it blank for the next 7 days), then scrapes every Flagship, Smitty's, Regal and Apple Cinemas theatre and saves everything to **one file, `scraped-all-showtimes.csv`**, in the project folder. Import that single file in the admin panel. You can skip the question:

```bash
npm run scrape -- --end=2026-11-30   # through Nov 30, inclusive
npm run scrape -- --days=14          # today plus the next 13 days
```

## Individual chains

| Chain | Command | Theatres | Output file |
| --- | --- | --- | --- |
| Flagship Cinemas | `npm run scrape:flagship` | Auburn, Falmouth, Thomaston, Waterville, Wells | `scraped-{city}-flagship-showtimes.csv` |
| Smitty's Entertainment | `npm run scrape:smittys` | Sanford, Topsham, Windham | `scraped-{city}-smittys-showtimes.csv` |
| Regal Cinemas | `npm run scrape:regal` | Augusta | `scraped-{city}-regal-showtimes.csv` |
| Apple Cinemas | `npm run scrape:apple` | Saco, Westbrook | `scraped-{city}-apple-showtimes.csv` |

These write one CSV per theatre instead of the combined file. They all work the same way. Run with no options and they ask for a city (or `all`) and an end date, or pass options to skip the questions:

```bash
npm run scrape:flagship -- --city=Wells --end=2026-11-30
npm run scrape:regal -- --city=all --days=3
```

(`node scripts/scrape-flagship.mjs --city=Wells ...` works too.)

## Date range

- `--end=YYYY-MM-DD` scrapes through that date, including it. If a theatre hasn't posted showtimes that far ahead, you get everything that is posted, and the scraper prints how far the data actually goes (`Showtimes are only posted through 2026-12-24 (requested through 2027-03-01)`).
- `--days=N` scrapes N days starting today.
- With neither, 7 days. Use one or the other, not both.

## Output

Every scraper writes the same columns as the admin CSV template (see README):
- `theatre_name` - `Flagship Cinemas`, `Smitty's Entertainment`, `Regal Cinemas` or `Apple Cinemas`; `theatre_city` tells theatres apart
- `film_title` - movie title as listed by the theatre (Apple titles have extra spaces and a trailing `(2026)` removed)
- `show_date` - `YYYY-MM-DD`
- `show_times` - pipe-separated, one row per film per date, duplicates removed (e.g. `12:30 PM|3:20 PM|6:00 PM`)
- `premium_show_times` - 3D showings (all chains except Smitty's); IMAX, ACX, ScreenX etc. stay in `show_times`
- `film_year` - Flagship and Regal (re-releases get the re-release year), and Apple when the title ends in a year like `(2026)`
- `film_tmdb_id` - Flagship only
- everything else is left blank for you to fill in

## How each scraper works

All requests are spaced 400 ms apart, and blocked or failed requests (403, 429, 5xx) are retried after a pause. Browser launch, requests, prompts, date ranges and CSV formatting are shared in `scripts/lib/scraper-utils.mjs`.

**Flagship** (no browser). `[city].flagshipcinemas.com` redirects to `flagshipcinemas.com/[city]`, an INDY Systems app that loads everything from a public GraphQL API at `flagshipcinemas.com/graphql` (it needs a `circuit-id: 83` header). The scraper:
1. Calls the same startup config the site requests on every page load, to get the site ID for each city (Auburn 338, Falmouth 339, Thomaston 340, Waterville 341, Wells 342) and the ID of the `3D` badge.
2. For each theatre, calls `datesWithShowing` to find which dates have showings, then `showingsForDate(date, siteIds)` for each of those dates in the range.
3. Skips unpublished and private showings, converts the UTC timestamps to Eastern time, and files each showing under its Eastern date.
4. Fills `film_year` and `film_tmdb_id` from the movie data, and puts showings with the 3D badge in `premium_show_times`.

**Smitty's** (no browser). A Theater Toolkit site. Windham is closed for renovation but is scraped anyway; until it lists films again it prints "No movies listed for Windham" and writes no CSV. The scraper downloads the location page to get the movie list, then each movie page. Every movie page contains an `ld+json` list of `screeningEvent`s with the full upcoming schedule at that location (`"StartDate": "Tuesday, October 6, 2026 6:30 PM"`), and that list is the data source. If a page's list is missing or won't parse, it falls back to the endpoint the date picker uses (`/theater/movietimes?locationKey=…&featureName=…&day=M/D/YYYY`) and logs a warning.

**Regal** (browser). regmovies.com is behind a Cloudflare bot check, so plain requests get a "Just a moment..." page. The scraper opens the theatre page once in a stealth browser, reads the list of dates with showings from the page's `__NEXT_DATA__`, then calls `/api/getShowtimes?theatres=1704&date=MM-DD-YYYY` (the endpoint the site's date buttons use) from inside the page for each date in range. Times come from `CalendarShowTime` (theatre-local), 3D comes from `PerformanceAttributes`, and `film_year` from each film's `OpeningDate`. To add a Regal theatre, add its URL slug and code (the number at the end of its regmovies.com URL) to `THEATRES` in `scrape-regal.mjs`.

**Apple Cinemas** (browser). applecinemas.com is an Angular app on a JSON API behind Cloudflare, so plain requests get a 403. The scraper opens the site once in a stealth browser and calls the API from inside the page:
1. `/Kiosk/GetAllCompanyLocationMoviesOptimized/f604d90/{locationId}` lists each theatre's films, now playing and pre-sales. Pre-sale films include their first showtime (`advanceShowTime`), and dates before it are skipped.
2. For each film and each date, `/Kiosk/GetLocationonlineMoviesOptimized/f604d90/{movieId}/{date}T00:00:00.000Z/{date}T23:59:59.000Z` returns that film's showings at every Apple location for that one day (a wider range still returns only the first day). Saco and Westbrook come from the same request.
3. Showtimes are labelled `+00:00` but are really theatre-local time (the site shows `12:00:00+00:00` as 12:00 PM), so they're read as-is. Showings tagged `3D` in `screenInfo` go to `premium_show_times`.

To add an Apple theatre, add its city and location ID (the last part of its URL on https://www.applecinemas.com/locations) to `THEATRES` in `scrape-apple-cinema.mjs`.

Timing: a full 7-day `npm run scrape` takes a few minutes; Apple is the slowest, at about one request per film per day.

## Import to the app

1. Open the admin panel.
2. **Import CSV** and choose `scraped-all-showtimes.csv` (or a single theatre's file).
3. **Save All Changes**.

## Troubleshooting

- **"HTTP 403, retrying"**: the site is rate-limiting. Wait a few minutes and run again.
- **Flagship: "GraphQL error"**: the API's schema changed. Compare `SHOWINGS_QUERY` in `scrape-flagship.mjs` with the `showingsForDate` request the site makes (browser dev tools, Network tab, filter `graphql`).
- **Flagship: "site for X not found"**: Flagship renamed or closed that theatre.
- **Smitty's: "no ld+json screening list"**: the site changed its markup. The fallback still works, but check `extractFromLdJson`.
- **Regal: timeout waiting for the page**: the Cloudflare check didn't clear. Run it again; if it keeps happening, the stealth plugin may need updating (`npm update puppeteer-extra-plugin-stealth`).
- **Regal: "request kept failing"**: the `/api/getShowtimes` endpoint changed. Click a date on the theatre page with the Network tab open to see the new request.
- **Apple: timeout loading applecinemas.com**: the Cloudflare check didn't clear. Run it again.
- **Apple: "request kept failing"**: the API changed. Open a film on applecinemas.com with the Network tab open and compare the `Kiosk/...` requests with the ones in `scrape-apple-cinema.mjs`.
