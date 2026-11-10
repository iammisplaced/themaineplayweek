// Scrapes showtimes from the Colonial Theatre (Belfast) into an admin import CSV.
//
// The theatre's site (built on CineSync) loads its schedule from an API that only answers
// requests the page itself makes, so this opens the Buy Tickets page in a browser, clicks
// each day in the date picker and reads the schedule the page loads for it.
//
// Usage: node scripts/scrape-colonial.mjs [--city=Belfast|all] [--end=YYYY-MM-DD | --days=7]

import {
  formatShowtimesCsv,
  getArg,
  launchBrowser,
  logCoverage,
  prompt,
  resolveDateRange,
  sleep,
  writeScrapedCsv,
} from './lib/scraper-utils.mjs';

// To add a theatre, add its city, name (as saved in the admin panel) and Buy Tickets page.
const THEATRES = {
  Belfast: {
    name: 'Colonial Theatre',
    url: 'https://www.colonialtheatre.com/buy-tickets',
  },
};
const CITIES = Object.keys(THEATRES);
const TIME_ZONE = 'America/New_York';
const SCHEDULE_REQUEST = /\/cms_widget\/index$/;
const DAY_BUTTON = 'button.day_card';
const LOAD_TIMEOUT_MS = 30000;

function easternTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

// Curly apostrophes and quotes become straight ones, as the saved titles have them.
function cleanTitle(name) {
  return String(name || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// '7:00PM' -> '7:00 PM'
function parseTime(slot) {
  const match = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(String(slot || '').trim());
  return match ? `${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}` : null;
}

async function waitFor(check, what) {
  for (const deadline = Date.now() + LOAD_TIMEOUT_MS; Date.now() < deadline; await sleep(250)) {
    if (check()) return;
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function scrapeCity(page, city, { fromIso, toIso }) {
  const { name, url } = THEATRES[city];
  console.log(`\n=== ${city} (${fromIso} to ${toIso}) ===`);

  // The page asks for the dates that have showings, then for one day's films at a time.
  let postedDates = null;
  const filmsByDate = new Map();
  const onResponse = async response => {
    if (!SCHEDULE_REQUEST.test(response.url()) || response.request().method() !== 'POST') return;
    try {
      const request = JSON.parse(response.request().postData() || '{}');
      const data = (await response.json()).data;
      if (request.api === 'dates') postedDates = (data.dates || []).map(d => d.session_start_date);
      if (request.api === 'list' && request.session_date) filmsByDate.set(request.session_date, data.movies || []);
    } catch {
      // Not a schedule response; the waits below report anything that never arrives.
    }
  };
  page.on('response', onResponse);

  const showings = [];
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitFor(() => postedDates, 'the list of dates');
    await page.waitForSelector(DAY_BUTTON);

    for (const [index, date] of postedDates.entries()) {
      if (date < fromIso || date > toIso) continue;
      if (!filmsByDate.has(date)) {
        // The date picker's buttons are in the same order as the dates.
        const clicked = await page.evaluate((selector, i) => {
          const button = document.querySelectorAll(selector)[i];
          button?.click();
          return Boolean(button);
        }, DAY_BUTTON, index);
        if (!clicked) throw new Error(`No date picker button for ${date}`);
        await waitFor(() => filmsByDate.has(date), `showtimes for ${date}`);
      }

      for (const film of filmsByDate.get(date)) {
        const title = cleanTitle(film.movie_name);
        for (const showTime of film.show_times || []) {
          const time = parseTime(showTime.show_time_slots);
          if (!time) {
            console.warn(`  Skipped "${title}" on ${date}: unreadable time "${showTime.show_time_slots}"`);
            continue;
          }
          showings.push({ title, date, time });
        }
      }
      console.log(`  ${date}: ${showings.filter(showing => showing.date === date).length} showings`);
    }
  } finally {
    page.off('response', onResponse);
  }

  if (showings.length === 0) {
    console.warn(`No showtimes posted for ${city} in this range; no CSV written.`);
    return;
  }
  logCoverage(showings, toIso);
  const filename = `scraped-${city.toLowerCase().replace(/\s+/g, '-')}-colonial-showtimes.csv`;
  writeScrapedCsv(filename, formatShowtimesCsv(showings, name, city));
  console.log(`  Saved to ${filename}`);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== Colonial Theatre Showtimes Scraper ===\n');
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
  const failed = [];
  try {
    for (const city of cities) {
      try {
        await scrapeCity(page, city, range);
      } catch (error) {
        console.error(`${city} FAILED: ${error.message}`);
        failed.push(city);
      }
    }
  } finally {
    await browser.close();
  }
  if (failed.length) {
    console.error(`\nFailed theatres (no CSV): ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Scraping failed:', error.message);
  process.exitCode = 1;
});
