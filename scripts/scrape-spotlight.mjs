// Scrapes showtimes from Spotlight Cinemas (spotlightcinemas.com) into an admin import CSV.
//
// The site renders each day's showtimes into the theatre page's HTML (index.php?date=YYYYMMDD), so
// no browser is needed. Nothing lists which dates have showings and posted dates can have gaps, so
// every date in the range is fetched. Times have no AM/PM; see addMeridiems.
//
// Usage: node scripts/scrape-spotlight.mjs [--city=Skowhegan|all] [--end=YYYY-MM-DD | --days=7]

import {
  addDaysIso,
  addMeridiems,
  fetchText,
  formatShowtimesCsv,
  getArg,
  logCoverage,
  prompt,
  resolveDateRange,
  writeScrapedCsv,
} from './lib/scraper-utils.mjs';

// To add a theatre, add its city, name (as saved in the admin panel) and page URL.
const THEATRES = {
  Skowhegan: { name: 'Spotlight Cinemas', url: 'https://spotlightcinemas.com/skowhegan/index.php' },
};
const CITIES = Object.keys(THEATRES);
const TIME_ZONE = 'America/New_York';
const PREMIUM_FORMATS = [
  [/\bIMAX\b/i, 'IMAX'],
  [/\b3-?D\b/i, '3D'],
];

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

// The date the page is showing, from its date picker ("Fri, 11-06-2026" -> "2026-11-06").
function selectedDate(html) {
  const match = html.match(/name="date"[^>]*value="\w+, (\d{2})-(\d{2})-(\d{4})"/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : '';
}

// Each film card's title and groups of times. A group ends at its labels ("2D"), which
// follow the times.
function parseDayPage(html) {
  return html.split('<div class="card">').slice(1).flatMap(card => {
    const title = decodeHtml(card.match(/class="card-title[^"]*">([^<]+)</)?.[1] || '');
    if (!title) return [];
    const groups = [];
    let group = null;
    // The times are in the page twice, as a badge for phones and a button for larger
    // screens; the badges are read here.
    const items = card.split('card-footer')[0].matchAll(/badge-primary[^"]*">([^<]+)<|class="attribute">([^<]+)</g);
    for (const [, time, label] of items) {
      if (time) {
        if (!group || group.labels.length) {
          group = { times: [], labels: [] };
          groups.push(group);
        }
        group.times.push(decodeHtml(time));
      } else if (group) {
        group.labels.push(decodeHtml(label));
      }
    }
    return groups.map(({ times, labels }) => {
      const label = labels.join(' ');
      return { title, times, premium: PREMIUM_FORMATS.find(([pattern]) => pattern.test(label))?.[1] || '' };
    });
  });
}

function toCsvShowing(showing, date) {
  const resolved = addMeridiems(showing.times);
  const unclear = showing.times.filter((_, index) => !resolved[index]);
  if (unclear.length) {
    console.warn(`  ${date}: skipped ${showing.title} at ${unclear.join(', ')}: can't tell AM from PM, so add by hand`);
  }
  return { title: showing.title, premium: showing.premium, date, times: resolved.filter(Boolean) };
}

async function scrapeCity(city, { fromIso, toIso }) {
  const { name, url } = THEATRES[city];
  console.log(`\n=== ${city} (${fromIso} to ${toIso}) ===`);
  const showings = [];
  for (let date = fromIso; date <= toIso; date = addDaysIso(date, 1)) {
    const html = await fetchText(`${url}?date=${date.replaceAll('-', '')}`);
    if (selectedDate(html) !== date) {
      console.warn(`  ${date}: the site showed ${selectedDate(html) || 'another date'} instead; skipped`);
      continue;
    }
    if (html.includes('not yet posted')) continue;
    const dayShowings = parseDayPage(html).map(showing => toCsvShowing(showing, date));
    if (dayShowings.length === 0) console.warn(`  ${date}: no showtimes found on the page`);
    else console.log(`  ${date}: ${dayShowings.reduce((total, showing) => total + showing.times.length, 0)} showings`);
    showings.push(...dayShowings);
  }

  if (!showings.some(showing => showing.times.length)) {
    console.warn(`No showtimes posted for ${city} in this range; no CSV written.`);
    return;
  }
  logCoverage(showings, toIso);
  const filename = `scraped-${city.toLowerCase().replace(/\s+/g, '-')}-spotlight-showtimes.csv`;
  writeScrapedCsv(filename, formatShowtimesCsv(showings, name, city));
  console.log(`  Saved to ${filename}`);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== Spotlight Cinemas Showtimes Scraper ===\n');
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
