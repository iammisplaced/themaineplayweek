// Scrapes showtimes from CinemaPlus theatre sites (yourneighborhoodtheatre.com) into admin
// import CSVs, one per theatre.
//
// CinemaPlus renders each day's showtimes into the theatre page's HTML (?date=YYYY-MM-DD), so no
// browser is needed. Each page lists every date that has showings, which tells us which days to
// fetch. 3D showings are listed as their own film ("AVENGERS DOOMSDAY 3D"); they're merged into
// the regular film and go to premium_show_times with a note. Titles are all caps on the site, so
// they're converted to title case.
//
// Usage: node scripts/scrape-cinemaplus.mjs [--city=Bangor|all] [--end=YYYY-MM-DD | --days=7]

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

// To add a theatre, add its city, name (as saved in the admin panel) and showtimes page URL.
const THEATRES = {
  Bangor: { name: 'Bangor Mall Cinemas', url: 'https://www.yourneighborhoodtheatre.com/bangor-mall-cinema-10' },
};
const CITIES = Object.keys(THEATRES);
const TIME_ZONE = 'America/New_York';
// Premium formats, found at the end of a film's title or in a showtime group's heading
// (headings are usually just "Reserved Seating").
const PREMIUM_FORMATS = [
  [/\bIMAX\b/i, 'IMAX'],
  [/\b3-?D\b/i, '3D'],
];
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);

function easternTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

function decodeHtml(text) {
  return String(text)
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "SENSE AND SENSIBILITY" -> "Sense and Sensibility"; "PRACTICAL MAGIC 2" -> "Practical Magic 2"
function titleCase(title) {
  return title.toLowerCase().replace(/[a-z0-9']+/g, (word, offset) => {
    const startsPhrase = offset === 0 || /[:\-–]\s*$/.test(title.slice(0, offset));
    if (!startsPhrase && SMALL_WORDS.has(word)) return word;
    return word[0].toUpperCase() + word.slice(1);
  });
}

// Same comparison the admin import uses to match films, so "SPIDER MAN" lines up with "SPIDER-MAN".
function titleKey(title) {
  return title.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// "AVENGERS DOOMSDAY 3D" -> { title: "AVENGERS DOOMSDAY", format: "3D" }
function splitFormatFromTitle(rawTitle) {
  for (const [pattern, format] of PREMIUM_FORMATS) {
    const match = new RegExp(`^(.*\\S)\\s+(?:in\\s+)?${pattern.source}$`, 'i').exec(rawTitle);
    if (match) return { title: match[1], format };
  }
  return { title: rawTitle, format: '' };
}

function headingFormats(heading) {
  return PREMIUM_FORMATS.filter(([pattern]) => pattern.test(heading)).map(([, format]) => format);
}

// "3:00p" -> "3:00 PM"
function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])m?$/i.exec(text.trim());
  return match ? `${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}M` : null;
}

function datesWithShowings(html) {
  return [...new Set([...html.matchAll(/[?&]date=(\d{4}-\d{2}-\d{2})/g)].map(match => match[1]))].sort();
}

/** Film cards on one day's page -> [{ rawTitle, format, time }]. */
function parseDayPage(html) {
  const showings = [];
  // Each film card starts with the poster link; split on the card wrapper.
  const cards = html.split('<div class="flex flex-col rounded-xl bg-white shadow-lg"').slice(1);
  for (const card of cards) {
    const titleMatch = /<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>/.exec(card);
    if (!titleMatch) continue;
    const rawTitle = decodeHtml(titleMatch[1]);
    // Showtimes are grouped under headings like "Reserved Seating"; each group is a heading div
    // followed by the buttons.
    const groups = card.split(/<div class="mt-3 mb-3 flex[^"]*">/).slice(1);
    for (const group of groups) {
      const heading = decodeHtml(group.slice(0, group.indexOf('<')));
      for (const [, text] of group.matchAll(/class="cin-showtimes-button[^"]*"[^>]*>([^<]+)<\/a>/g)) {
        const time = parseTime(decodeHtml(text));
        if (time) showings.push({ rawTitle, heading, time });
        else console.warn(`    Unrecognized time "${decodeHtml(text)}" for ${rawTitle}`);
      }
    }
  }
  return showings;
}

/**
 * Turns raw showings into CSV showings. 3D listings are filed under the matching regular film's
 * title when there is one ("AVENGERS DOOMSDAY 3D" -> "AVENGERS: DOOMSDAY").
 */
function toCsvShowings(rawShowings) {
  const titleByKey = new Map();
  const split = rawShowings.map(s => ({ ...s, ...splitFormatFromTitle(s.rawTitle) }));
  // Regular listings name the film first, so their punctuation wins.
  for (const s of [...split].sort((a, b) => Boolean(a.format) - Boolean(b.format))) {
    if (!titleByKey.has(titleKey(s.title))) titleByKey.set(titleKey(s.title), titleCase(s.title));
  }
  return split.map(s => ({
    title: titleByKey.get(titleKey(s.title)),
    date: s.date,
    time: s.time,
    // A 3D listing's showtimes also sit under a "3D" heading, so drop the repeat.
    premium: [...new Set([s.format, ...headingFormats(s.heading)])].filter(Boolean).join(' '),
  }));
}

async function scrapeCity(city, { fromIso, toIso }) {
  const { url } = THEATRES[city];
  console.log(`\n=== ${city} (${fromIso} to ${toIso}) ===`);
  const firstPage = await fetchText(`${url}?date=${fromIso}`);
  const dates = datesWithShowings(firstPage).filter(date => date >= fromIso && date <= toIso);
  if (dates.length === 0) {
    console.warn(`No showtimes posted for ${city} in this range; no CSV written.`);
    return;
  }

  const rawShowings = [];
  for (const date of dates) {
    const html = date === fromIso ? firstPage : await fetchText(`${url}?date=${date}`);
    const dayShowings = parseDayPage(html).map(s => ({ ...s, date }));
    if (dayShowings.length === 0) console.warn(`  ${date}: no showtimes found on the page`);
    else console.log(`  ${date}: ${dayShowings.length} showings`);
    rawShowings.push(...dayShowings);
  }
  writeCityCsv(city, toCsvShowings(rawShowings), toIso);
}

function writeCityCsv(city, showings, toIso) {
  if (showings.length === 0) {
    console.warn(`No showtimes found for ${city}; no CSV written.`);
    return;
  }
  showings.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || compareTimes(a.time, b.time));
  const csv = formatShowtimesCsv(showings, THEATRES[city].name, city);
  const filename = writeScrapedCsv(`scraped-${city.toLowerCase()}-cinemaplus-showtimes.csv`, csv);
  const premiumCount = showings.filter(s => s.premium).length;
  console.log(`${city}: saved ${showings.length} showings (${premiumCount} premium) to ${filename}`);
  logCoverage(showings, toIso);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== CinemaPlus Showtimes Scraper ===\n');
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
