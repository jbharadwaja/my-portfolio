import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageWeights } from '../js/engine/formations/image-weights.js';
import { buildPortrait } from '../js/engine/formations/portrait.js';
import { mulberry32 } from '../js/engine/formations/common.js';
import { portraitLayout, entranceMode } from '../js/sections/hero.js';
const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [l, a] = f(x, y); d.set([l, l, l, a], (y * w + x) * 4); } return { width: w, height: h, data: d }; };
const half = img(40, 40, (x) => [x < 20 ? 0 : 255, 255]);
test('dark side outweighs light side', () => {
  const { weights, gw, gh } = imageWeights(half, { gw: 40, featherEdges: {} });
  let l = 0, r = 0; for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) (x < 15 ? (l += weights[y * gw + x]) : x > 25 ? (r += weights[y * gw + x]) : 0);
  assert.ok(l > 4 * r);
});
test('transparent pixels weigh nothing', () => assert.equal(imageWeights(img(10, 10, () => [0, 0]), { gw: 10 }).weights.reduce((a, b) => a + b, 0), 0));
test('top feather zeroes the first row', () => { const { weights, gw } = imageWeights(half, { gw: 40 }); assert.equal(weights.slice(0, gw).reduce((a, b) => a + b, 0), 0); });
test('portrait formation shape', () => {
  const f = buildPortrait(2000, { image: half, rng: mulberry32(3) });
  assert.equal(f.data.length, 8000);
  for (let i = 0; i < 2000; i++) { assert.ok(f.data[i * 4 + 3] >= 0 && f.data[i * 4 + 3] <= 1); assert.ok(Math.abs(f.data[i * 4]) <= f.box.w / 2 + 1e-6); }
});
test('strip layout when there is room', () => assert.deepEqual(portraitLayout({ vw: 1440, vh: 900, h1Right: 800 }), { mode: 'strip', rect: { x: 832, y: 90, w: 560, h: 774 } }));
test('bottom layout when the strip is too narrow', () => assert.deepEqual(portraitLayout({ vw: 1440, vh: 900, h1Right: 1000 }), { mode: 'bottom', rect: { x: 0, y: 450, w: 1440, h: 450 } }));
test('bottom layout under 1024', () => assert.equal(portraitLayout({ vw: 900, vh: 1000, h1Right: 300 }).mode, 'bottom'));
test('entrance skipped off the hero', () => { assert.equal(entranceMode({ inHero: true }), 'play'); assert.equal(entranceMode({ inHero: false }), 'skip'); });
test('portrait relief stays within ±0.15 and the dark side carries the larger darkness meta', () => {
  const f = buildPortrait(4000, { image: half, rng: mulberry32(5) });
  let dark = 0, light = 0, nDark = 0, nLight = 0;
  for (let i = 0; i < 4000; i++) {
    const [x, , z, meta] = f.data.subarray(i * 4, i * 4 + 4);
    assert.ok(Math.abs(z) <= 0.15 + 1e-6);
    if (x < -0.25 * f.box.w) { dark += meta; nDark++; } else if (x > 0.25 * f.box.w) { light += meta; nLight++; }
  }
  assert.ok(nDark > nLight && dark / nDark > 2 * (light / nLight));
});
test('layout rects are whole pixels for a fractional name edge and viewport', () => {
  const { rect } = portraitLayout({ vw: 1440, vh: 845, h1Right: 800.6 });
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(rect[k]), k);
  assert.ok(Object.values(portraitLayout({ vw: 390, vh: 845, h1Right: 374 }).rect).every(Number.isInteger));
});
