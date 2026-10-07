// Scrapes Smitty's Entertainment showtimes (Theater Toolkit site) into an admin import CSV.
//
// Each movie page embeds an ld+json ItemList of screeningEvents covering every upcoming
// showing at that location, so no browser is needed. If a page's ld+json is missing or
// unparseable we fall back to the per-day endpoint the site's date picker calls.
//
// Usage: node scripts/scrape-smittys.mjs [--city=Sanford|Topsham|all] [--days=7]

import { compareTimes } from '../js/shared.js';
import { fetchText, formatShowtimesCsv, prompt, writeCsvToRepoRoot } from './lib/scraper-utils.mjs';

const BASE_URL = 'https://www.smittyscinema.com';
const THEATRE_NAME = "Smitty's Entertainment";
const CITIES = ['Sanford', 'Topsham'];
const DEFAULT_DAYS = 7;

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function getArg(name) {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function toIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayIso() {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function normalizeTime(value) {
  const match = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(value);
  return match ? `${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}` : null;
}

// "Tuesday, October 6, 2026 6:30 PM" -> { date: "2026-10-06", time: "6:30 PM" }
function parseStartDate(value) {
  const match = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(String(value || ''));
  const month = match && MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return { date: toIsoDate(Number(match[3]), month, Number(match[2])), time: normalizeTime(match[4]) };
}

// "10/6/2026" -> "2026-10-06"
function parseSlashDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value || '').trim());
  return match ? toIsoDate(Number(match[3]), Number(match[1]), Number(match[2])) : null;
}

function parseJsonLenient(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Theater Toolkit occasionally emits raw control characters (e.g. newlines in a
    // description) inside strings, which JSON.parse rejects.
    return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '));
  }
}

async function getMovieUrls(city) {
  const html = await fetchText(`${BASE_URL}/movie-theater/${city.toLowerCase()}`);
  const byKey = new Map();
  for (const [, href] of html.matchAll(/href="([^"#?]*\/movie\/[^"#?]+)/gi)) {
    const url = new URL(href, BASE_URL);
    const [, , locationKey] = url.pathname.split('/');
    if (locationKey?.toLowerCase() !== city.toLowerCase()) continue;
    const key = url.pathname.toLowerCase().replace(/\/+$/, '');
    if (!byKey.has(key)) byKey.set(key, url.href);
  }
  return [...byKey.values()];
}

// Returns [{ title, date, time }] or null if the page has no usable ld+json.
function extractFromLdJson(html, city) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let sawItemList = false;
  const showings = [];

  for (const [, raw] of blocks) {
    let data;
    try {
      data = parseJsonLenient(raw);
    } catch (error) {
      console.warn(`    ld+json parse failed: ${error.message}`);
      continue;
    }
    if (data?.['@type'] !== 'ItemList' || !Array.isArray(data.ItemListElement)) continue;
    sawItemList = true;

    for (const { Item: event } of data.ItemListElement) {
      const locality = event?.Location?.Address?.AddressLocality;
      if (locality && locality.toLowerCase() !== city.toLowerCase()) continue;
      const start = parseStartDate(event?.StartDate);
      if (!start?.time) {
        console.warn(`    Unrecognised StartDate: ${event?.StartDate}`);
        continue;
      }
      showings.push({ title: decodeHtml(event.Name), ...start });
    }
  }

  return sawItemList ? showings : null;
}

async function extractFromDayEndpoint(html, city, fromIso, toIso) {
  const featureName = /movieTimes\.featureName = `([^`]+)`/.exec(html)?.[1];
  if (!featureName) return [];

  const dates = [...new Set([...html.matchAll(/data-date="([^"]+)"/g)].map(m => m[1]))]
    .filter(day => {
      const iso = parseSlashDate(day);
      return iso && iso >= fromIso && iso <= toIso;
    });

  const showings = [];
  for (const day of dates) {
    const url = encodeURI(
      `${BASE_URL}/theater/movietimes?locationKey=${city.toLowerCase()}` +
      `&featureName=${featureName.replace('&', '--').replace('?', '--')}&day=${day}`
    );
    const fragment = await fetchText(url);
    for (const [, label] of fragment.matchAll(/button--showtime[\s\S]*?<span>([^<]+)<\/span>/g)) {
      const time = normalizeTime(label);
      if (time) showings.push({ title: decodeHtml(featureName), date: parseSlashDate(day), time });
    }
  }
  return showings;
}

async function scrapeCity(city, days) {
  const fromIso = todayIso();
  const toIso = addDaysIso(fromIso, days - 1);
  console.log(`\n=== ${city} (${fromIso} to ${toIso}) ===`);

  const movieUrls = await getMovieUrls(city);
  console.log(`Found ${movieUrls.length} movies`);

  const showings = [];
  const failures = [];
  for (const url of movieUrls) {
    const label = decodeURIComponent(url.split('/').pop());
    try {
      const html = await fetchText(url);
      let movieShowings = extractFromLdJson(html, city);
      if (movieShowings === null) {
        console.warn(`  ${label}: no ld+json screening list, using per-day endpoint`);
        movieShowings = await extractFromDayEndpoint(html, city, fromIso, toIso);
      }
      const inRange = movieShowings.filter(s => s.date >= fromIso && s.date <= toIso);
      console.log(`  ${label}: ${inRange.length} showings in range (${movieShowings.length} total)`);
      showings.push(...inRange);
    } catch (error) {
      console.error(`  ${label}: FAILED - ${error.message}`);
      failures.push(label);
    }
  }

  if (failures.length) console.warn(`\n${failures.length} movie(s) failed: ${failures.join(', ')}`);
  if (showings.length === 0) {
    console.warn(`No showtimes found for ${city}; no CSV written.`);
    return;
  }

  showings.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || compareTimes(a.time, b.time));
  const csv = formatShowtimesCsv(showings, THEATRE_NAME, city);
  const filename = writeCsvToRepoRoot(`scraped-${city.toLowerCase()}-smittys-showtimes.csv`, csv);
  console.log(`\nSaved ${showings.length} showings to ${filename}`);

  const byDate = {};
  showings.forEach(s => { byDate[s.date] = (byDate[s.date] || 0) + 1; });
  Object.entries(byDate).forEach(([date, count]) => console.log(`  ${date}: ${count} showings`));
}

async function main() {
  let cityArg = getArg('city');
  if (!cityArg) {
    console.log("=== Smitty's Entertainment Showtimes Scraper ===\n");
    cityArg = await prompt(`Enter theatre city (${CITIES.join(', ')} or all):\n> `);
  }

  const cities = cityArg.toLowerCase() === 'all'
    ? CITIES
    : CITIES.filter(city => city.toLowerCase() === cityArg.toLowerCase());
  if (cities.length === 0) {
    throw new Error(`Invalid theatre city "${cityArg}". Use: ${CITIES.join(', ')} or all`);
  }

  const days = Number(getArg('days') || DEFAULT_DAYS);
  if (!Number.isInteger(days) || days < 1) throw new Error('--days must be a positive whole number');

  for (const city of cities) await scrapeCity(city, days);
}

main().catch(error => {
  console.error('Scraping failed:', error.message);
  process.exitCode = 1;
});
