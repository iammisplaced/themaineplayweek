// Scrapes showtimes from the Maine Film Center (Waterville) into an admin import CSV.
//
// Waterville Creates sells tickets through Spektrix, whose public API lists every event and
// its showings as plain JSON, so no browser is needed. The same box office sells Opera House
// shows and gallery classes; only events whose organization is "Maine Film Center" are kept.
// Times in the API are the theatre's local time. Open-captioned showings get an "Open Captions"
// note.
//
// Usage: node scripts/scrape-maine-film-center.mjs [--city=Waterville|all] [--end=YYYY-MM-DD | --days=7]

import {
  addDaysIso,
  fetchText,
  formatShowtimesCsv,
  getArg,
  logCoverage,
  prompt,
  resolveDateRange,
  writeScrapedCsv,
} from './lib/scraper-utils.mjs';

// To add a theatre, add its city, name (as saved in the admin panel), Spektrix API and
// organization name.
const THEATRES = {
  Waterville: {
    name: 'Maine Film Center',
    api: 'https://boxoffice.watervillecreates.org/watervillecreates/api/v3',
    organization: 'Maine Film Center',
  },
};
const CITIES = Object.keys(THEATRES);
const TIME_ZONE = 'America/New_York';

function easternTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url, { headers: { accept: 'application/json' } }));
}

// 'Miracle on 34th Street (1947)' -> { title: 'Miracle on 34th Street', year: 1947 }.
// Curly apostrophes and quotes become straight ones, as the saved titles have them.
function cleanTitle(name) {
  const title = String(name || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  const match = /^(.*\S)\s*\((\d{4})\)$/.exec(title);
  return match ? { title: match[1], year: Number(match[2]) } : { title, year: null };
}

// '2026-11-10T19:00:00' -> { date: '2026-11-10', time: '7:00 PM' }
function parseStart(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const hour24 = Number(match[2]);
  return { date: match[1], time: `${hour24 % 12 || 12}:${match[3]} ${hour24 < 12 ? 'AM' : 'PM'}` };
}

async function scrapeCity(city, { fromIso, toIso }) {
  const { name, api, organization } = THEATRES[city];
  console.log(`\n=== ${city} (${fromIso} to ${toIso}) ===`);

  // Every event the box office has ever sold; keep this theatre's that overlap the range.
  const events = (await fetchJson(`${api}/events`)).filter(event =>
    event.attribute_Organization === organization
    && String(event.lastInstanceDateTime).slice(0, 10) >= fromIso
    && String(event.firstInstanceDateTime).slice(0, 10) <= toIso);

  const showings = [];
  for (const event of events) {
    const { title, year } = cleanTitle(event.name);
    const instances = await fetchJson(`${api}/events/${event.id}/instances`);
    for (const instance of instances) {
      if (instance.cancelled || instance.attribute_HideOnSite) continue;
      const start = parseStart(instance.start);
      if (!start || start.date < fromIso || start.date > toIso) continue;
      const note = instance.attribute_OpenCaptionedScreening ? 'Open Captions' : '';
      showings.push({ title, year, date: start.date, time: start.time, note });
    }
  }

  if (showings.length === 0) {
    console.warn(`No showtimes posted for ${city} in this range; no CSV written.`);
    return;
  }
  showings.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  for (let date = fromIso; date <= toIso; date = addDaysIso(date, 1)) {
    const count = showings.filter(showing => showing.date === date).length;
    if (count) console.log(`  ${date}: ${count} showings`);
  }
  logCoverage(showings, toIso);
  const filename = `scraped-${city.toLowerCase().replace(/\s+/g, '-')}-maine-film-center-showtimes.csv`;
  writeScrapedCsv(filename, formatShowtimesCsv(showings, name, city));
  console.log(`  Saved to ${filename}`);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== Maine Film Center Showtimes Scraper ===\n');
    cityArg = await prompt(`Enter theatre city (${CITIES.join(', ')} or all):\n> `);
  }

  const cities = cityArg.toLowerCase() === 'all'
    ? CITIES
    : CITIES.filter(city => city.toLowerCase() === cityArg.toLowerCase());
  if (cities.length === 0) {
    throw new Error(`Invalid theatre city "${cityArg}". Use: ${CITIES.join(', ')} or all`);
  }

  const range = await resolveDateRange(easternTodayIso(), { ask: interactive });
  const failed = [];
  for (const city of cities) {
    try {
      await scrapeCity(city, range);
    } catch (error) {
      console.error(`${city} FAILED: ${error.message}`);
      failed.push(city);
    }
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
