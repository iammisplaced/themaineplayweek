# Showtimes Scraper Guide

Scrapers that pull showtimes from theatre chains' websites and save CSVs ready for the admin **Import CSV** feature.

## Quick start

Run `npm install` once, then:

```bash
npm run scrape
```

It asks for an end date (leave it blank for the next 7 days), then scrapes every Flagship, Smitty's and Regal theatre and saves everything to **one file, `scraped-all-showtimes.csv`**, in the project folder. Import that single file in the admin panel. You can skip the question:

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
| Apple Cinemas | `npm run scrape:apple` | any (asks for a URL) | `scraped-{city}-apple-showtimes.csv` |

These write one CSV per theatre instead of the combined file. Flagship, Smitty's and Regal all work the same way. Run with no options and they ask for a city (or `all`) and an end date, or pass options to skip the questions:

```bash
npm run scrape:flagship -- --city=Wells --end=2026-11-30
npm run scrape:regal -- --city=all --days=3
```

(`node scripts/scrape-flagship.mjs --city=Wells ...` works too.)

Apple Cinemas is the odd one out: it isn't part of `npm run scrape`, it asks for a theatre URL, name and city, and it always scrapes 7 days.

## Date range

- `--end=YYYY-MM-DD` scrapes through that date, including it. If a theatre hasn't posted showtimes that far ahead, you get everything that is posted, and the scraper prints how far the data actually goes (`Showtimes are only posted through 2026-12-24 (requested through 2027-03-01)`).
- `--days=N` scrapes N days starting today.
- With neither, 7 days. Use one or the other, not both.

## Output

Every scraper writes the same columns as the admin CSV template (see README):
- `theatre_name` - `Flagship Cinemas`, `Smitty's Entertainment` or `Regal Cinemas` (Apple uses what you type); `theatre_city` tells theatres apart
- `film_title` - movie title as listed by the theatre
- `show_date` - `YYYY-MM-DD`
- `show_times` - pipe-separated, one row per film per date, duplicates removed (e.g. `12:30 PM|3:20 PM|6:00 PM`)
- `premium_show_times` - 3D showings (Flagship and Regal)
- `film_year` - Flagship and Regal (re-releases get the re-release year)
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

**Apple Cinemas** (browser) goes through each NOW PLAYING film:
1. Clicks the film, then handles any confirmation modal (Yes/OK) and the location modal (clicks your city; if your city isn't listed, the film has no showtimes there and is skipped).
2. Reads the times for the date the page opens on. This is the soonest showtime, which isn't always today.
3. Steps through the date picker. It stops when a date opens a modal or has no data.

Theatre URLs for Apple: go to https://www.applecinemas.com/locations, open the theatre and copy its URL, e.g. `https://www.applecinemas.com/home/611fea26f74bab2423301ee4`.

Timing: a full 7-day `npm run scrape` takes a minute or two.

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
- **Apple: "location not found" for a film**: that film isn't playing at your theatre.
