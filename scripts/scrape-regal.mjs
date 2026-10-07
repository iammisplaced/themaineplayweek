// Scrapes Regal showtimes into admin import CSVs, one per theatre.
//
// regmovies.com sits behind a Cloudflare bot check, so we open the theatre page once in a
// stealth browser, then call the JSON endpoint the site's own date picker uses
// (/api/getShowtimes) from inside that page for each date in range. 3D, IMAX, RPX, 4DX and
// ScreenX showings go to premium_show_times with a note naming the format, and film_year comes
// from each film's opening date.
//
// Usage: node scripts/scrape-regal.mjs [--city=Augusta|all] [--end=YYYY-MM-DD | --days=7]

import { compareTimes } from '../js/shared.js';
import {
  fetchJsonInPage,
  formatShowtimesCsv,
  getArg,
  launchBrowser,
  logCoverage,
  prompt,
  resolveDateRange,
  writeScrapedCsv,
} from './lib/scraper-utils.mjs';

const BASE_URL = 'https://www.regmovies.com';
const THEATRE_NAME = 'Regal Cinemas';
// To add a theatre, copy the last part of its regmovies.com/theatres/... URL; the code is the number at the end.
const THEATRES = {
  Augusta: { route: 'regal-augusta-1704', code: '1704' },
};
const CITIES = Object.keys(THEATRES);
const TIME_ZONE = 'America/New_York';
// PerformanceAttributes that make a showing premium, in the order they're named in the note.
const PREMIUM_FORMATS = ['IMAX', 'RPX', '4DX', 'ScreenX', '3D'];

function easternTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

// "2026-10-10" -> "10-10-2026", the format /api/getShowtimes expects
function toRegalDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

// "2026-10-10T19:30:00" (theatre-local) -> { date: "2026-10-10", time: "7:30 PM" }
function parseCalendarShowTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const hour24 = Number(match[2]);
  const hour12 = hour24 % 12 || 12;
  return { date: match[1], time: `${hour12}:${match[3]} ${hour24 < 12 ? 'AM' : 'PM'}` };
}

// ["2D", "IMAX", "Recliner"] -> "IMAX"; standard showings -> ""
function premiumFormat(attributes) {
  return PREMIUM_FORMATS.filter(format => attributes.some(attr => new RegExp(`\\b${format}\\b`, 'i').test(attr))).join(' ');
}

function extractShowings(response) {
  const yearByMovieCode = new Map(
    (response.movies || []).map(movie => [movie.MasterMovieCode, Number(String(movie.OpeningDate || '').slice(0, 4)) || null])
  );

  const showings = [];
  for (const show of response.shows || []) {
    for (const film of show.Film || []) {
      const title = String(film.Title || '').trim();
      if (!title) continue;
      for (const performance of film.Performances || []) {
        const local = parseCalendarShowTime(performance.CalendarShowTime);
        if (!local) continue;
        showings.push({
          title,
          ...local,
          premium: premiumFormat(performance.PerformanceAttributes || []),
          year: yearByMovieCode.get(film.MasterMovieCode) || null,
        });
      }
    }
  }
  return showings;
}

async function scrapeTheatre(page, city, { fromIso, toIso }) {
  const { route, code } = THEATRES[city];
  console.log(`\n=== ${city} (${fromIso} to ${toIso}) ===`);

  console.log('  Loading theatre page...');
  await page.goto(`${BASE_URL}/theatres/${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__NEXT_DATA__?.props?.pageProps, { timeout: 45000 });
  const datesWithShows = await page.evaluate(() => window.__NEXT_DATA__.props.pageProps.datesWithShows || []);
  const dates = [...new Set(datesWithShows.map(d => String(d).slice(0, 10)))]
    .filter(d => d >= fromIso && d <= toIso)
    .sort();

  const showings = [];
  for (const date of dates) {
    const url = `/api/getShowtimes?theatres=${code}&date=${toRegalDate(date)}&hoCode=&ignoreCache=false&moviesOnly=false`;
    const dayShowings = extractShowings(await fetchJsonInPage(page, url))
      .filter(s => s.date >= fromIso && s.date <= toIso);
    console.log(`  ${date}: ${dayShowings.length} showings`);
    showings.push(...dayShowings);
  }

  if (showings.length === 0) {
    console.warn(`No showtimes found for ${city}; no CSV written.`);
    return;
  }

  showings.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || compareTimes(a.time, b.time));
  const csv = formatShowtimesCsv(showings, THEATRE_NAME, city);
  const filename = writeScrapedCsv(`scraped-${city.toLowerCase()}-regal-showtimes.csv`, csv);
  const premiumCount = showings.filter(s => s.premium).length;
  console.log(`Saved ${showings.length} showings (${premiumCount} premium) to ${filename}`);
  logCoverage(showings, toIso);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== Regal Showtimes Scraper ===\n');
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
  const failures = [];
  try {
    for (const city of cities) {
      try {
        await scrapeTheatre(page, city, range);
      } catch (error) {
        console.error(`${city} FAILED: ${error.message}`);
        failures.push(city);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`\nFailed: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Scraping failed:', error.message);
  process.exitCode = 1;
});
