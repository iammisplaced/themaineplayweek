import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the script as a desktop browser would, where it adds no banner, then test its functions.
const context = vm.createContext({
  navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' },
  document: { addEventListener() {} },
});
vm.runInContext(readFileSync(new URL('../js/app-banner.js', import.meta.url), 'utf8'), context);
const { appBannerStore, isAppBannerHidden } = context;

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko)';

test('iPhone Safari gets no custom banner, since Apple shows its own', () => {
  assert.equal(appBannerStore(`${IPHONE} Version/18.0 Mobile/15E148 Safari/604.1`), '');
});

test('other iPhone browsers get the App Store', () => {
  for (const rest of [
    'CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    'FxiOS/130.0 Mobile/15E148 Safari/605.1.15',
    'Version/18.0 EdgiOS/130.0 Mobile/15E148 Safari/604.1',
    'Version/18.0 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15',
    'GSA/340.0 Mobile/15E148 Safari/604.1',
    'Mobile/22A3354 Instagram 350.0',
    'Mobile/22A3354 [FBAN/FBIOS;FBAV/480.0]',
    'Mobile/15E148',
  ]) {
    assert.equal(appBannerStore(`${IPHONE} ${rest}`), 'ios', rest);
  }
});

test('Android browsers and in-app browsers get Google Play', () => {
  assert.equal(appBannerStore(`${ANDROID} Chrome/130.0.0.0 Mobile Safari/537.36`), 'android');
  assert.equal(appBannerStore('Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0'), 'android');
  assert.equal(appBannerStore(`${ANDROID} Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;]`), 'android');
});

test('desktop browsers and crawlers get no banner', () => {
  assert.equal(appBannerStore(context.navigator.userAgent), '');
  assert.equal(appBannerStore('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36'), '');
  assert.equal(
    appBannerStore(`${ANDROID} Chrome/130.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`),
    '',
  );
});

test('the banner stays hidden for 60 days', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;
  assert.equal(isAppBannerHidden(null, now), false);
  assert.equal(isAppBannerHidden('junk', now), false);
  assert.equal(isAppBannerHidden(String(now - 59 * day), now), true);
  assert.equal(isAppBannerHidden(String(now - 61 * day), now), false);
});
