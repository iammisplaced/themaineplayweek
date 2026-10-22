// Scrapes showtimes from Mobile Moviegoing theatre sites (blackbearcinemas.com, patriotcinemas.com)
// into admin import CSVs, one per theatre.
//
// Mobile Moviegoing sites load showtimes from a public JSON API (api-v3.mobilemoviegoing.cloud), so
// no browser is needed. Each chain's site has an exhibitor ID (`eid`) and each theatre a location ID,
// both found in the site's home page HTML (`const eid = ...`, `const sites = [...]`). One request
// per day returns that day's films and showings plus a calendar of which dates have showings.
// Showings with a 3D or IMAX attribute go to premium_show_times with a note naming the format.
//
// Usage: node scripts/scrape-mobile-moviegoing.mjs [--city=Orono|Freeport|Portland|all] [--end=YYYY-MM-DD | --days=7]

import { compareTimes } from '../js/shared.js';
import {
  fetchText,
  formatShowtimesCsv,
  getArg,
  logCoverage,
  prompt,
  resolveDateRange,
  writeScrapedCsv,
} from './lib/scraper-utils.mjs';

const API_URL = 'https://api-v3.mobilemoviegoing.cloud/include/app/getShowtimesByDayDisplay.php';
const PATRIOT = { site: 'https://www.patriotcinemas.com', eid: '87452aba-2d93-42a3-afed-b2b21b2b5341' };
// To add a theatre, add its city, name (as saved in the admin panel), site, eid and location ID.
const THEATRES = {
  Orono: {
    name: 'Black Bear Cinemas',
    site: 'https://www.blackbearcinemas.com',
    eid: '962c2580-be20-47d2-b9be-20ce4d2961e9',
    location: '00001-00001-00001',
  },
  Freeport: { name: 'Patriot Cinemas at Freeport Village', ...PATRIOT, location: '00001-00001-00004' },
  Portland: { name: 'Nickelodeon Cinemas', ...PATRIOT, location: '00001-00001-00003' },
};
const CITIES = Object.keys(THEATRES);
const TIME_ZONE = 'America/New_York';
// Showing attribute names that make a showing premium -> the format named in the note.
// Others ("Open Caption", "Sensory Show", "Stadium Seating") stay in show_times.
const PREMIUM_FORMATS = [
  [/^IMAX$/i, 'IMAX'],
  [/^3-?D$/i, '3D'],
];

function easternTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

const toApiDate = iso => iso.replace(/-/g, '');
const fromApiDate = date => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

/** One day's listings: { date, films, validDates } with dates as YYYY-MM-DD. */
async function fetchDay(theatre, iso) {
  const text = await fetchText(API_URL, {
    method: 'POST',
    // The API answers 403 without the theatre site as the origin.
    headers: { origin: theatre.site, 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ eid: theatre.eid, pos_route: 1, date: toApiDate(iso), mode: 'byDay', location: theatre.location }),
  });
  const { films, validDates = {}, current_date: currentDate } = JSON.parse(text);
  return {
    date: currentDate ? fromApiDate(currentDate) : '',
    films: films || [],
    validDates: Object.keys(validDates).filter(date => validDates[date]).map(fromApiDate).sort(),
  };
}

// startTime is the theatre's local clock time written as a Unix timestamp in UTC
// (the site formats it with zone 'utc'), so read it back in UTC.
function parseShowTime(startTime) {
  const date = new Date(Number(startTime) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const hour24 = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return { date: date.toISOString().slice(0, 10), time: `${hour24 % 12 || 12}:${minutes} ${hour24 < 12 ? 'AM' : 'PM'}` };
}

// [{ attrib: '<span ...>3D</span>' }, { POSName: 'Hearing Impaired Track' }] -> "3D"
function premiumFormat(attributes) {
  const names = attributes.map(attr => String(attr.attrib || attr.POSName || '').replace(/<[^>]*>/g, '').trim());
  const formats = names.map(name => PREMIUM_FORMATS.find(([pattern]) => pattern.test(name))?.[1]);
  return [...new Set(formats.filter(Boolean))].join(' ');
}

function extractShowings(films) {
  return films.flatMap(film => {
    const title = String(film.dispName || '').replace(/\s+/g, ' ').trim();
    return (film.screenings || []).flatMap(screening => {
      const local = parseShowTime(screening.startTime);
      if (!local) return [];
      return [{ title, ...local, premium: premiumFormat(screening.attributes || []) }];
    });
  });
}

async function scrapeCity(city, { fromIso, toIso }) {
  const theatre = THEATRES[city];
  console.log(`\n=== ${city} (${fromIso} to ${toIso}) ===`);
  const firstDay = await fetchDay(theatre, fromIso);
  const dates = firstDay.validDates.filter(date => date >= fromIso && date <= toIso);
  if (dates.length === 0) {
    console.warn(`No showtimes posted for ${city} in this range; no CSV written.`);
    return;
  }

  const showings = [];
  for (const date of dates) {
    const day = date === fromIso ? firstDay : await fetchDay(theatre, date);
    if (day.date !== date) {
      console.warn(`  ${date}: the site sent ${day.date || 'another date'} instead; skipped`);
      continue;
    }
    const dayShowings = extractShowings(day.films);
    if (dayShowings.length === 0) console.warn(`  ${date}: no showtimes found`);
    else console.log(`  ${date}: ${dayShowings.length} showings`);
    showings.push(...dayShowings);
  }
  writeCityCsv(city, showings, toIso);
}

function writeCityCsv(city, showings, toIso) {
  if (showings.length === 0) {
    console.warn(`No showtimes found for ${city}; no CSV written.`);
    return;
  }
  showings.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || compareTimes(a.time, b.time));
  const csv = formatShowtimesCsv(showings, THEATRES[city].name, city);
  const filename = writeScrapedCsv(`scraped-${city.toLowerCase()}-mobile-moviegoing-showtimes.csv`, csv);
  const premiumCount = showings.filter(s => s.premium).length;
  console.log(`${city}: saved ${showings.length} showings (${premiumCount} premium) to ${filename}`);
  logCoverage(showings, toIso);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== Mobile Moviegoing Showtimes Scraper ===\n');
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
