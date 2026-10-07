// Runs every automated scraper (Flagship, Smitty's, Regal) for all of its theatres and
// combines the results into a single CSV, scraped-all-showtimes.csv, in the project folder.
//
// Usage: npm run scrape [-- --end=YYYY-MM-DD | -- --days=N]
// With neither option it asks for an end date once and uses it for every chain.
// Apple Cinemas isn't included because it still needs a theatre URL typed in.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveDateRange, writeScrapedCsv } from './lib/scraper-utils.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMBINED_FILENAME = 'scraped-all-showtimes.csv';
const SCRAPERS = [
  { name: 'Flagship Cinemas', file: 'scrape-flagship.mjs' },
  { name: "Smitty's Entertainment", file: 'scrape-smittys.mjs' },
  { name: 'Regal', file: 'scrape-regal.mjs' },
];

function runScraper(file, args, outputDir) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, file), ...args], {
      stdio: 'inherit',
      env: { ...process.env, SCRAPE_OUTPUT_DIR: outputDir },
    });
    child.on('close', code => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function main() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const { toIso } = await resolveDateRange(today, { ask: true });
  const args = ['--city=all', `--end=${toIso}`];
  console.log(`Scraping all theatres through ${toIso}`);

  // Each scraper writes its per-theatre CSVs here; they're combined below.
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-showtimes-scrape-'));
  try {
    const results = [];
    for (const { name, file } of SCRAPERS) {
      console.log(`\n############ ${name} ############`);
      results.push({ name, ok: await runScraper(file, args, outputDir) });
    }

    console.log('\n############ Summary ############');
    results.forEach(({ name, ok }) => console.log(`  ${ok ? 'OK    ' : 'FAILED'} ${name}`));
    writeCombinedCsv(outputDir);
    if (results.some(r => !r.ok)) process.exitCode = 1;
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

function writeCombinedCsv(outputDir) {
  const files = fs.readdirSync(outputDir).filter(name => name.endsWith('.csv')).sort();
  if (files.length === 0) {
    console.warn('\nNo showtimes were scraped; no CSV written.');
    return;
  }

  let header = '';
  const bodies = [];
  for (const name of files) {
    const csv = fs.readFileSync(path.join(outputDir, name), 'utf8');
    const headerEnd = csv.indexOf('\n');
    if (headerEnd === -1) continue; // header only, no rows
    header ||= csv.slice(0, headerEnd);
    bodies.push(csv.slice(headerEnd + 1));
  }

  const rowCount = bodies.reduce((total, body) => total + body.split('\n').filter(Boolean).length, 0);
  writeScrapedCsv(COMBINED_FILENAME, [header, ...bodies].join('\n'));
  console.log(`\nSaved ${rowCount} rows from ${files.length} theatres to ${COMBINED_FILENAME}, ready for Import CSV in the admin panel.`);
}

main().catch(error => {
  console.error('Scraping failed:', error.message);
  process.exitCode = 1;
});
