// Scrapes Apple Cinemas showtimes into admin import CSVs, one per theatre.
//
// applecinemas.com is an Angular app on a JSON API behind Cloudflare, so we open the site once
// in a stealth browser and call the API from inside that page. Each theatre's film list comes
// from GetAllCompanyLocationMoviesOptimized; showtimes come from GetLocationonlineMoviesOptimized,
// which returns one film's showings for one day at every Apple location. 3D showings go to
// premium_show_times, and a trailing "(2026)" in a title becomes film_year.
//
// Usage: node scripts/scrape-apple-cinema.mjs [--city=Saco|Westbrook|all] [--end=YYYY-MM-DD | --days=7]

import { compareTimes } from '../js/shared.js';
import {
  addDaysIso,
  fetchJsonInPage,
  formatShowtimesCsv,
  getArg,
  launchBrowser,
  logCoverage,
  prompt,
  resolveDateRange,
  writeScrapedCsv,
} from './lib/scraper-utils.mjs';

const BASE_URL = 'https://www.applecinemas.com';
const COMPANY_ID = 'f604d90';
const THEATRE_NAME = 'Apple Cinemas';
// Location IDs are the last part of the theatre's URL on applecinemas.com/locations.
const THEATRES = {
  Saco: '611fea26f74bab2423301ee4',
  Westbrook: '611fe9edf74bab2423301ee0',
};
const CITIES = Object.keys(THEATRES);
const TIME_ZONE = 'America/New_York';

function easternTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

// "PAW Patrol: The Dino Movie   (2026)" -> { title: "PAW Patrol: The Dino Movie", year: 2026 }
function cleanTitle(name) {
  const title = String(name || '').replace(/\s+/g, ' ').trim();
  const match = /^(.*\S)\s*\((\d{4})\)$/.exec(title);
  return match ? { title: match[1], year: Number(match[2]) } : { title, year: null };
}

// The API labels times as UTC ("2026-10-10T19:30:00+00:00") but they are the theatre's local
// time, which is what the site shows, so read the clock time as-is.
function parseShowTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const hour24 = Number(match[2]);
  const hour12 = hour24 % 12 || 12;
  return { date: match[1], time: `${hour12}:${match[3]} ${hour24 < 12 ? 'AM' : 'PM'}` };
}

/**
 * Films listed at any of the cities, keyed by movie ID. Pre-sale films carry their first
 * showtime (advanceShowTime), so dates before it are skipped.
 */
async function loadFilms(page, cities) {
  const films = new Map();
  for (const city of cities) {
    const { schedules = [] } = await fetchJsonInPage(page, `/Kiosk/GetAllCompanyLocationMoviesOptimized/${COMPANY_ID}/${THEATRES[city]}`);
    for (const film of schedules) {
      const firstDate = film.isAdvance && film.advanceShowTime ? String(film.advanceShowTime).slice(0, 10) : '';
      const existing = films.get(film.actualMovieId);
      if (existing) {
        if (existing.firstDate > firstDate) existing.firstDate = firstDate;
      } else {
        films.set(film.actualMovieId, { ...cleanTitle(film.movieName), firstDate });
      }
    }
    console.log(`  ${city}: ${schedules.length} films listed`);
  }
  return films;
}

function extractShowings(response, film) {
  const showingsByCity = {};
  for (const listing of response || []) {
    const city = CITIES.find(c => THEATRES[c] === listing.locationId);
    if (!city) continue;
    for (const screen of listing.screens || []) {
      for (const show of screen.showTimes || []) {
        const local = parseShowTime(show.showTime);
        if (!local) continue;
        (showingsByCity[city] ||= []).push({
          title: film.title,
          ...local,
          premium: (show.screenInfo || []).some(info => /\b3D\b/i.test(info)),
          year: film.year,
        });
      }
    }
  }
  return showingsByCity;
}

async function scrapeCities(page, cities, { fromIso, toIso }) {
  console.log(`\n=== ${cities.join(', ')} (${fromIso} to ${toIso}) ===`);
  console.log('  Loading applecinemas.com...');
  await page.goto(`${BASE_URL}/home/${THEATRES[cities[0]]}`, { waitUntil: 'networkidle2', timeout: 60000 });

  const films = await loadFilms(page, cities);
  const showingsByCity = Object.fromEntries(cities.map(city => [city, []]));
  const failedFilms = [];

  // One request per film per day covers every city at once.
  for (const [movieId, film] of films) {
    const startIso = film.firstDate > fromIso ? film.firstDate : fromIso;
    if (startIso > toIso) continue;
    let count = 0;
    try {
      for (let date = startIso; date <= toIso; date = addDaysIso(date, 1)) {
        const url = `/Kiosk/GetLocationonlineMoviesOptimized/${COMPANY_ID}/${movieId}/${date}T00:00:00.000Z/${date}T23:59:59.000Z`;
        const dayShowings = extractShowings(await fetchJsonInPage(page, url), film);
        for (const [city, showings] of Object.entries(dayShowings)) {
          const inRange = showings.filter(s => s.date >= fromIso && s.date <= toIso);
          showingsByCity[city]?.push(...inRange);
          count += inRange.length;
        }
      }
    } catch (error) {
      console.error(`  ${film.title} FAILED: ${error.message}`);
      failedFilms.push(film.title);
      continue;
    }
    if (count) console.log(`  ${film.title}: ${count} showings`);
  }

  for (const city of cities) writeCityCsv(city, showingsByCity[city], toIso);
  return failedFilms;
}

function writeCityCsv(city, showings, toIso) {
  if (showings.length === 0) {
    console.warn(`No showtimes found for ${city}; no CSV written.`);
    return;
  }
  showings.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || compareTimes(a.time, b.time));
  const csv = formatShowtimesCsv(showings, THEATRE_NAME, city);
  const filename = writeScrapedCsv(`scraped-${city.toLowerCase()}-apple-showtimes.csv`, csv);
  const premiumCount = showings.filter(s => s.premium).length;
  console.log(`${city}: saved ${showings.length} showings (${premiumCount} 3D) to ${filename}`);
  logCoverage(showings, toIso);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== Apple Cinemas Showtimes Scraper ===\n');
    cityArg = await prompt(`Enter theatre city (${CITIES.join(', ')} or all):\n> `);
  }

  const cities = cityArg.toLowerCase() === 'all'
    ? CITIES
    : CITIES.filter(city => city.toLowerCase() === cityArg.toLowerCase());
  if (cities.length === 0) {
    throw new Error(`Invalid theatre city "${cityArg}". Use: ${CITIES.join(', ')} or all`);
  }

  const range = await resolveDateRange(easternTodayIso(), { ask: interactive });
  const { browser, page } = await launchBrowser();
  try {
    const failedFilms = await scrapeCities(page, cities, range);
    if (failedFilms.length) {
      console.error(`\nFailed films (missing from the CSV): ${failedFilms.join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('Scraping failed:', error.message);
  process.exitCode = 1;
});
