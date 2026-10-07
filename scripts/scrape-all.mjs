// Runs every automated scraper (Flagship, Smitty's, Regal) for all of its theatres.
//
// Usage: npm run scrape [-- --end=YYYY-MM-DD | -- --days=N]
// With neither option it asks for an end date once and uses it for every chain.
// Apple Cinemas isn't included because it still needs a theatre URL typed in.

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveDateRange } from './lib/scraper-utils.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRAPERS = [
  { name: 'Flagship Cinemas', file: 'scrape-flagship.mjs' },
  { name: "Smitty's Entertainment", file: 'scrape-smittys.mjs' },
  { name: 'Regal', file: 'scrape-regal.mjs' },
];

function runScraper(file, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, file), ...args], { stdio: 'inherit' });
    child.on('close', code => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function main() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const { toIso } = await resolveDateRange(today, { ask: true });
  const args = ['--city=all', `--end=${toIso}`];
  console.log(`Scraping all theatres through ${toIso}`);

  const results = [];
  for (const { name, file } of SCRAPERS) {
    console.log(`\n############ ${name} ############`);
    results.push({ name, ok: await runScraper(file, args) });
  }

  console.log('\n############ Summary ############');
  results.forEach(({ name, ok }) => console.log(`  ${ok ? 'OK    ' : 'FAILED'} ${name}`));
  console.log('\nCSVs are in the project folder (scraped-*.csv), ready for Import CSV in the admin panel.');
  if (results.some(r => !r.ok)) process.exitCode = 1;
}

main().catch(error => {
  console.error('Scraping failed:', error.message);
  process.exitCode = 1;
});
