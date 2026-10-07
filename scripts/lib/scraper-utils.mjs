import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Matches the admin "Import CSV" format documented in README.md.
const CSV_HEADERS = [
  'theatre_name',
  'theatre_city',
  'film_title',
  'show_date',
  'show_times',
  'premium_show_times',
  'room',
  'notes',
  'festival_name',
  'ticket_link',
  'film_year',
  'film_tmdb_id',
];

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
// Theatre sites start answering 403 if hit too quickly, so space requests out and back off on errors.
const REQUEST_DELAY_MS = 400;
const RETRY_DELAYS_MS = [5000, 15000];

/** fetch() that paces requests and retries 403/429/5xx and network errors. Returns the body text. */
export async function fetchText(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    await sleep(REQUEST_DELAY_MS);
    let reason;
    try {
      const res = await fetch(url, { ...init, headers: { 'user-agent': USER_AGENT, ...init.headers } });
      if (res.ok) return await res.text();
      reason = `HTTP ${res.status}`;
      const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
      if (!retryable) throw new Error(`${url}: ${reason}`);
    } catch (error) {
      if (!reason) reason = error.message; // network error: retry
      else throw error;
    }
    if (attempt >= RETRY_DELAYS_MS.length) throw new Error(`${url}: ${reason}`);
    console.warn(`    ${reason}, retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s...`);
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

export async function launchBrowser() {
  // Loaded lazily so the fetch-only scrapers don't pay for Puppeteer.
  const { default: puppeteer } = await import('puppeteer-extra');
  const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setDefaultTimeout(30000);
  await page.setDefaultNavigationTimeout(30000);
  return { browser, page };
}

function escapeCsvCell(cell) {
  const str = String(cell || '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Builds an import CSV. Each showing is `{ title, date, time, premium?, year?, tmdbId? }`,
 * or uses `times: [...]` in place of `time`. Rows are merged per film + date, premium
 * showings go to premium_show_times, and duplicate times are dropped.
 */
export function formatShowtimesCsv(showings, theatreName, theatreCity) {
  const grouped = new Map();
  showings.forEach(showing => {
    const key = `${showing.title}|${showing.date}`;
    if (!grouped.has(key)) {
      grouped.set(key, { title: showing.title, date: showing.date, times: new Set(), premiumTimes: new Set() });
    }
    const entry = grouped.get(key);
    entry.year ||= showing.year;
    entry.tmdbId ||= showing.tmdbId;
    const target = showing.premium ? entry.premiumTimes : entry.times;
    (showing.times || [showing.time]).filter(Boolean).forEach(time => target.add(time));
  });

  const rows = [CSV_HEADERS];
  grouped.forEach(showing => {
    rows.push([
      theatreName,
      theatreCity,
      showing.title,
      showing.date,
      [...showing.times].join('|'),
      [...showing.premiumTimes].join('|'),
      '',
      '',
      '',
      '',
      showing.year || '',
      showing.tmdbId || '',
    ]);
  });

  return rows.map(row => row.map(escapeCsvCell).join(',')).join('\n');
}

/** Writes the CSV to the repo root and returns the filename. */
export function writeCsvToRepoRoot(filename, csv) {
  fs.writeFileSync(path.join(REPO_ROOT, filename), csv);
  return filename;
}
