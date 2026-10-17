import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const count = (re) => (html.match(re) || []).length;
test('one h1 with the name', () => {
  assert.equal(count(/<h1[\s>]/g), 1);
  assert.match(html, /<h1[^>]*>[\s\S]*JULIAN[\s\S]*BHARADWAJA[\s\S]*<\/h1>/);
});
test('sections in order with HUD labels', () => {
  const ids = [...html.matchAll(/<section[^>]*id="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['top', 'encoder', 'training', 'work', 'route', 'about', 'contact']);
  const huds = [...html.matchAll(/data-hud="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(huds, ['01 / 07  HERO', '02 / 07  ENCODER', '03 / 07  TRAINING', '04 / 07  EXPERIMENTS', '05 / 07  ROUTE', '06 / 07  ABOUT', '07 / 07  CONTACT']);
  assert.equal(count(/<h2[\s>]/g), 6);
});
test('eight cards with verdicts and machine values', () => {
  const verdicts = [...html.matchAll(/<article class="card[^"]*"[^>]*data-verdict="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(verdicts, ['BEAT TARGET', 'LEAKAGE FIXED', 'NEAR-TIE', 'LINEAR WON', 'LOW RISK', 'SHIPPED', 'IN PRODUCTION', 'ADOPTED']);
  assert.match(html, /data-index="EXP_01"[^>]*data-metric="0.90" data-compare="0.85" data-better="higher"/);
  assert.match(html, /data-index="EXP_03"[^>]*data-metric="9.41" data-compare="9.44" data-better="lower"/);
  assert.match(html, /data-index="EXP_04"[^>]*data-metric="34.5" data-compare="48" data-better="lower"/);
  assert.equal(count(/tabindex="0"/g), 8);
});
test('route stops carry coordinates', () => {
  const stops = [...html.matchAll(/data-stop="(\d)" data-lat="([-\d.]+)" data-lon="([-\d.]+)"/g)].map((m) => [m[2], m[3]]);
  assert.deepEqual(stops, [['14.08', '100.61'], ['35.68', '139.69'], ['37.57', '126.98'], ['33.75', '-117.83']]);
});
test('about photo is a real image with alt text', () => {
  assert.match(html, /<img[^>]*src="assets\/img\/portrait-full.webp"[^>]*alt="Julian Bharadwaja at a window overlooking the Grand Canyon"/);
});
test('CV links ship in the LinkedIn fallback state', () => {
  assert.equal(count(/class="js-cv[^"]*"[^>]*href="https:\/\/www.linkedin.com\/in\/julian-bharadwaja\/"/g), 3);
  assert.doesNotMatch(html, /assets\/cv\//);
});
test('no reference-site leftovers', () => {
  assert.doesNotMatch(html, /02d2e3|Oswald|Space Grotesk|Antonelli/i);
});
