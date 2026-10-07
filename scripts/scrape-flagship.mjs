// Scrapes Flagship Cinemas (Maine) showtimes into admin import CSVs, one per theatre.
//
// [city].flagshipcinemas.com redirects to flagshipcinemas.com/[city], an INDY Systems app
// that loads everything from a public GraphQL API. We call that API directly: datesWithShowing
// for each theatre, then one showingsForDate request per date in range. 3D showings go to
// premium_show_times.
//
// Usage: node scripts/scrape-flagship.mjs [--city=Auburn|Falmouth|Thomaston|Waterville|Wells|all] [--end=YYYY-MM-DD | --days=7]

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

const GRAPHQL_URL = 'https://flagshipcinemas.com/graphql';
const CIRCUIT_ID = '83';
const THEATRE_NAME = 'Flagship Cinemas';
const CITIES = ['Auburn', 'Falmouth', 'Thomaston', 'Waterville', 'Wells'];
const TIME_ZONE = 'America/New_York';
const PREMIUM_BADGE_NAMES = ['3D'];

// The same "validate" call the site makes on every page load; it returns the site list and badges.
const CONFIG_QUERY = `mutation ($clientConfigInput: ClientConfigInput!) {
  addOrUpdateClientConfig(input: {clientConfigInput: $clientConfigInput}) {
    clientConfig {
      sites { id name city deletedAt }
      showingBadges { id displayName }
    }
  }
}`;

const DATES_QUERY = `query ($siteIds: [ID]) {
  datesWithShowing(siteIds: $siteIds) { value }
}`;

const SHOWINGS_QUERY = `query ($date: String, $siteIds: [ID]) {
  showingsForDate(date: $date, siteIds: $siteIds) {
    data {
      id
      time
      published
      private
      showingBadgeIds
      movie { id name tmdbId releaseDate }
    }
  }
}`;

async function graphql(query, variables) {
  const text = await fetchText(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'circuit-id': CIRCUIT_ID,
      'client-type': 'consumer',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = JSON.parse(text);
  if (json.errors?.length || json.error) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors || json.error).slice(0, 300)}`);
  }
  return json.data;
}

const easternParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

// "2026-10-07T19:30:00Z" -> { date: "2026-10-07", time: "3:30 PM" } in Eastern time
function toEastern(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(easternParts.formatToParts(date).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`,
  };
}

function easternTodayIso() {
  return toEastern(new Date().toISOString()).date;
}

async function getDatesWithShowings(siteId) {
  const data = await graphql(DATES_QUERY, { siteIds: [siteId] });
  const dates = JSON.parse(data?.datesWithShowing?.value || '[]');
  return Array.isArray(dates) ? dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
}

async function loadConfig() {
  const data = await graphql(CONFIG_QUERY, { clientConfigInput: { version: null, action: 'validate' } });
  const config = data?.addOrUpdateClientConfig?.clientConfig;
  if (!config?.sites) throw new Error('Could not load the Flagship site list');

  const siteIdByCity = new Map();
  for (const city of CITIES) {
    const site = config.sites.find(s => !s.deletedAt && [s.name, s.city].some(n => n?.trim().toLowerCase() === city.toLowerCase()));
    if (!site) throw new Error(`Flagship site for ${city} not found in the site list`);
    siteIdByCity.set(city, site.id);
  }

  const premiumBadgeIds = new Set(
    (config.showingBadges || [])
      .filter(badge => PREMIUM_BADGE_NAMES.includes(badge.displayName?.trim()))
      .map(badge => badge.id)
  );
  if (premiumBadgeIds.size === 0) console.warn('Warning: no 3D badge found; all times will go to show_times');

  return { siteIdByCity, premiumBadgeIds };
}

async function scrapeCity(city, siteId, premiumBadgeIds, { fromIso, toIso }) {
  console.log(`\n=== ${city} (site ${siteId}, ${fromIso} to ${toIso}) ===`);

  const dates = (await getDatesWithShowings(siteId)).filter(d => d >= fromIso && d <= toIso);

  const showings = [];
  const seenShowingIds = new Set();
  let skipped = 0;

  for (const date of dates) {
    const data = await graphql(SHOWINGS_QUERY, { date, siteIds: [siteId] });
    const rows = data?.showingsForDate?.data || [];
    let kept = 0;

    for (const row of rows) {
      if (seenShowingIds.has(row.id)) continue;
      seenShowingIds.add(row.id);
      if (!row.published || row.private) {
        skipped++;
        continue;
      }
      const local = toEastern(row.time);
      const title = String(row.movie?.name || '').trim();
      // Group by the Eastern date of the showing itself, not the date we asked for.
      if (!local || !title || local.date < fromIso || local.date > toIso) continue;

      const year = Number(String(row.movie.releaseDate || '').slice(0, 4)) || null;
      showings.push({
        title,
        date: local.date,
        time: local.time,
        premium: (row.showingBadgeIds || []).some(id => premiumBadgeIds.has(String(id))),
        year,
        tmdbId: Number(row.movie.tmdbId) || null,
      });
      kept++;
    }
    console.log(`  ${date}: ${kept} showings`);
  }

  if (skipped) console.log(`  Skipped ${skipped} private/unpublished showings`);
  if (showings.length === 0) {
    console.warn(`No showtimes found for ${city}; no CSV written.`);
    return;
  }

  showings.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || compareTimes(a.time, b.time));
  const csv = formatShowtimesCsv(showings, THEATRE_NAME, city);
  const filename = writeScrapedCsv(`scraped-${city.toLowerCase()}-flagship-showtimes.csv`, csv);
  const premiumCount = showings.filter(s => s.premium).length;
  console.log(`Saved ${showings.length} showings (${premiumCount} 3D) to ${filename}`);
  logCoverage(showings, toIso);
}

async function main() {
  let cityArg = getArg('city');
  const interactive = !cityArg;
  if (interactive) {
    console.log('=== Flagship Cinemas Showtimes Scraper ===\n');
    cityArg = await prompt(`Enter theatre city (${CITIES.join(', ')} or all):\n> `);
  }

  const cities = cityArg.toLowerCase() === 'all'
    ? CITIES
    : CITIES.filter(city => city.toLowerCase() === cityArg.toLowerCase());
  if (cities.length === 0) {
    throw new Error(`Invalid theatre city "${cityArg}". Use: ${CITIES.join(', ')} or all`);
  }

  const range = await resolveDateRange(easternTodayIso(), { ask: interactive });
  const { siteIdByCity, premiumBadgeIds } = await loadConfig();
  const failures = [];
  for (const city of cities) {
    try {
      await scrapeCity(city, siteIdByCity.get(city), premiumBadgeIds, range);
    } catch (error) {
      console.error(`${city} FAILED: ${error.message}`);
      failures.push(city);
    }
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
