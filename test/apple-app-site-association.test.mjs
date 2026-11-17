import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

test('apple-app-site-association is valid JSON that links film pages to both app builds', () => {
  const aasa = readJson('.well-known/apple-app-site-association');
  const [details] = aasa.applinks.details;
  assert.deepEqual(details.appIDs.sort(), [
    '5JPJRAA9U5.com.themaineplayweek.app',
    '5JPJRAA9U5.com.themaineplayweek.app.dev',
  ]);
  assert.deepEqual(details.components.map((c) => c['/']), ['/films/*']);
});

test('vercel.json serves apple-app-site-association as JSON', () => {
  const { headers } = readJson('vercel.json');
  const rule = headers.find((h) => h.source === '/.well-known/apple-app-site-association');
  assert.ok(rule, 'header rule exists');
  assert.deepEqual(rule.headers, [{ key: 'Content-Type', value: 'application/json' }]);
});
