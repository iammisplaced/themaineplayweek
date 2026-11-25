import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const APP_STORE_ID = '6837351844';
const PLAY_ID = 'com.themaineplayweek.app';
const APP_STORE_URL = `https://apps.apple.com/us/app/the-maine-playweek/id${APP_STORE_ID}`;
const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_ID}`;

test("the main page, quiz and film pages have Safari's app banner", () => {
  for (const path of ['index.html', 'quiz/index.html', 'scripts/generate-film-pages.mjs']) {
    assert.match(read(path), new RegExp(`<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}`), path);
  }
});

test('the main page and film pages link to both stores', () => {
  for (const path of ['index.html', 'scripts/generate-film-pages.mjs']) {
    const html = read(path);
    assert.ok(html.includes(`href="${APP_STORE_URL}"`), path);
    assert.ok(html.includes(`href="${PLAY_URL}"`), path);
  }
});

test('the manifest offers the Play app instead of installing the site', () => {
  const manifest = JSON.parse(read('site.webmanifest'));
  assert.equal(manifest.prefer_related_applications, true);
  assert.deepEqual(
    manifest.related_applications.map(({ platform, id, url }) => [platform, id, url]),
    [['play', PLAY_ID, PLAY_URL], ['itunes', undefined, APP_STORE_URL]],
  );
});

test('assetlinks.json links the site to the Play app with a full SHA-256 fingerprint', () => {
  const [{ relation, target }, ...rest] = JSON.parse(read('.well-known/assetlinks.json'));
  assert.equal(rest.length, 0);
  assert.deepEqual(relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(target.namespace, 'android_app');
  assert.equal(target.package_name, PLAY_ID);
  for (const fingerprint of target.sha256_cert_fingerprints) {
    assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  }
});
