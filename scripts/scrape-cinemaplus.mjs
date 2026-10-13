// Scrapes showtimes from CinemaPlus theatre sites (yourneighborhoodtheatre.com,
// entertainmentcinemas.com) into admin import CSVs, one per theatre.
//
// CinemaPlus renders each day's showtimes into the theatre page's HTML (?date=YYYY-MM-DD), so no
// browser is needed. Each page's date calendar lists every date that has showings, which tells us
// which days to fetch. 3D showings may be listed as their own film ("AVENGERS DOOMSDAY 3D"); they're
// merged into the regular film and go to premium_show_times with a note. All-caps titles (Bangor)
// are converted to title case.
//
// Usage: node scripts/scrape-cinemaplus.mjs [--city=Bangor|"South Portland"|all] [--end=YYYY-MM-DD | --days=7]

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
  'South Portland': { name: 'Entertainment Luxury Cinemas', url: 'https://www.entertainmentcinemas.com/the-shops-at-clarks-pond' },
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

// The date calendar has an entry (id="js-YYYY-MM-DD") for every date with showings.
function datesWithShowings(html) {
  return [...new Set([...html.matchAll(/id="js-(\d{4}-\d{2}-\d{2})"/g)].map(match => match[1]))].sort();
}

// The date the page is showing. For a date with no showings the site quietly shows today instead.
function selectedDate(html) {
  return /getElementById\(['"]js-(\d{4}-\d{2}-\d{2})['"]\)/.exec(html)?.[1];
}

// CinemaPlus has two page layouts. In the older one (Bangor) each group of showtimes comes after
// a heading like "3D • Reserved Seating"; in the newer one (South Portland) the label follows the
// group ("Open Caption, Reserved Seating").
const CARD_START = /<div class="(?:flex flex-col rounded-xl bg-white shadow-lg|cin-movie-card)\b[^"]*"/;
const SHOWTIME_PARTS = new RegExp([
  /<div class="mt-3 mb-3 flex[^"]*">([\s\S]*?)<\/div>/.source, // heading before its times
  /<div class="mb-2 flex flex-wrap items-center border-b[^"]*">([\s\S]*?)<\/div>/.source, // label after
  /class="cin-showtimes-button\s[^"]*"[^>]*>([^<]+)<\/a>/.source, // a showtime
].join('|'), 'g');

/** Film cards on one day's page -> [{ rawTitle, heading, time }]. */
function parseDayPage(html) {
  const showings = [];
  for (const card of html.split(CARD_START).slice(1)) {
    const titleMatch = /<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>/.exec(card);
    if (!titleMatch) continue;
    const rawTitle = decodeHtml(titleMatch[1]);
    let heading = '';
    let unlabelled = [];
    for (const [, headingHtml, labelHtml, text] of card.matchAll(SHOWTIME_PARTS)) {
      if (headingHtml !== undefined) {
        heading = stripTags(headingHtml);
      } else if (labelHtml !== undefined) {
        unlabelled.forEach(showing => { showing.heading = stripTags(labelHtml); });
        unlabelled = [];
      } else {
        const time = parseTime(decodeHtml(text));
        if (!time) {
          console.warn(`    Unrecognized time "${decodeHtml(text)}" for ${rawTitle}`);
          continue;
        }
        const showing = { rawTitle, heading, time };
        showings.push(showing);
        if (!heading) unlabelled.push(showing);
      }
    }
  }
  return showings;
}

function stripTags(html) {
  return decodeHtml(html.replace(/<[^>]*>/g, ' '));
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
    const title = s.title === s.title.toUpperCase() ? titleCase(s.title) : s.title;
    if (!titleByKey.has(titleKey(s.title))) titleByKey.set(titleKey(s.title), title);
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
    if (selectedDate(html) !== date) {
      console.warn(`  ${date}: the site showed ${selectedDate(html) || 'another date'} instead; skipped`);
      continue;
    }
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
  const filename = writeScrapedCsv(`scraped-${city.toLowerCase().replace(/\s+/g, '-')}-cinemaplus-showtimes.csv`, csv);
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
