import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imageWeights } from '../js/engine/formations/image-weights.js';
import { buildPortrait } from '../js/engine/formations/portrait.js';
import { mulberry32 } from '../js/engine/formations/common.js';
import { portraitLayout, entranceMode, rushInput } from '../js/sections/hero.js';
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
test('bottom layout: hero text that can pass over the portrait carries its own paper ground (text >= 4.5:1)', () => {
  const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
  const rule = css.match(/\.portrait-bottom :is\(([^)]*)\)\s*\{([^}]*)\}/);
  assert.ok(rule, 'a .portrait-bottom :is(...) ground rule');
  const items = rule[1].split(',').map((s) => s.trim());
  for (const s of ['.hero-meta li > span', '.cv-inline', '.socials a', '.scroll-cue']) assert.ok(items.includes(s), s);
  assert.match(rule[2], /background:\s*var\(--bg\);/);
});
test('the denoise HUD carries its own paper ground in every layout (the entrance cloud swirls behind it)', () => {
  const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
  const rule = css.match(/(^|\n)\.hero-hud\s*\{([^}]*)\}/);
  assert.ok(rule, 'a .hero-hud rule');
  assert.match(rule[2], /background:\s*var\(--bg\);/);
});
test('strip layout at exactly vw = 1024, bottom just below it', () => {
  assert.deepEqual(portraitLayout({ vw: 1024, vh: 768, h1Right: 500 }), { mode: 'strip', rect: { x: 532, y: 77, w: 444, h: 660 } });
  assert.equal(portraitLayout({ vw: 1023, vh: 768, h1Right: 500 }).mode, 'bottom');
});
test('strip layout with the strip at exactly 34% of vw, bottom one pixel narrower', () => {
  // 0.34 · 1250 is 425.00000000000006 in floating point: the share must still count as 34%
  for (const vw of [1100, 1250]) {
    const w = (vw * 34) / 100;
    const h1Right = vw - 48 - w - 32;
    const at = portraitLayout({ vw, vh: 900, h1Right });
    assert.equal(at.mode, 'strip', `vw ${vw}`);
    assert.equal(at.rect.w, w);
    assert.equal(portraitLayout({ vw, vh: 900, h1Right: h1Right + 1 }).mode, 'bottom', `vw ${vw} − 1 px`);
  }
});
test('bottom layout frames the portrait into the measured slot, rounded', () => {
  const slotRect = { x: 16, y: 352.4, w: 358.2, h: 438.88 };
  assert.deepEqual(portraitLayout({ vw: 390, vh: 844, h1Right: 374, slotRect }), { mode: 'bottom', rect: { x: 16, y: 352, w: 358, h: 439 } });
  assert.deepEqual(portraitLayout({ vw: 1024, vh: 768, h1Right: 597, slotRect: { x: 34.13, y: 351.5, w: 563.2, h: 399.36 } }),
    { mode: 'bottom', rect: { x: 34, y: 352, w: 563, h: 399 } });
  // A slot ending exactly at the stage's bottom edge still fits
  assert.deepEqual(portraitLayout({ vw: 820, vh: 1180, h1Right: 793, slotRect: { x: 27, y: 620, w: 765, h: 560 }, copyTop: 112 }),
    { mode: 'bottom', rect: { x: 27, y: 620, w: 765, h: 560 } });
});
test('bottom layout: a slot running past the stage is framed where it sits once scrolled fully onto it, never above the copy', () => {
  // 1024 × 768: the slot overruns the fold by 19 px — moved up 19 px, same size, so the hood is no longer cut
  assert.deepEqual(portraitLayout({ vw: 1024, vh: 768, h1Right: 597, slotRect: { x: 34, y: 388, w: 563, h: 399 }, copyTop: 112 }),
    { mode: 'bottom', rect: { x: 34, y: 369, w: 563, h: 399 } });
  // 844 × 390: the slot starts below the stage (432 > 390). Scrolled onto the stage it would reach up to 70, above the
  // copy's top (112), so the rect starts at the copy's top and ends at the stage's bottom: at scroll 0 the face is
  // under the copy's paper ground, and it shows through the slot as the slot scrolls in.
  assert.deepEqual(portraitLayout({ vw: 844, vh: 390, h1Right: 816, slotRect: { x: 28, y: 432, w: 788, h: 320 }, copyTop: 112 }),
    { mode: 'bottom', rect: { x: 28, y: 112, w: 788, h: 278 } });
  // Every overrunning slot ends exactly at the stage's bottom edge, starts no higher than the copy, and is whole pixels
  for (const [vh, y, h] of [[390, 432, 320], [375, 401.6, 320], [430, 452.2, 320], [600, 470.4, 320], [768, 388.3, 399.4]]) {
    const { rect } = portraitLayout({ vw: 900, vh, h1Right: 870, slotRect: { x: 28, y, w: 844, h }, copyTop: 112 });
    assert.ok(Object.values(rect).every(Number.isInteger), `vh ${vh}: whole pixels`);
    assert.equal(rect.y + rect.h, vh, `vh ${vh}: ends at the stage's bottom`);
    assert.ok(rect.y >= 112 && rect.h <= Math.round(h), `vh ${vh}: below the copy's top, no taller than the slot`);
  }
});
test('the slot is ignored when the strip fits', () => {
  assert.deepEqual(portraitLayout({ vw: 1440, vh: 900, h1Right: 800, slotRect: { x: 48, y: 400, w: 744, h: 468 } }),
    { mode: 'strip', rect: { x: 832, y: 90, w: 560, h: 774 } });
});
test('default feathers: the last column (right, unfeathered) carries weight, the last row (bottom) is zero', () => {
  const grey = img(40, 40, () => [128, 255]);
  const { weights, gw, gh } = imageWeights(grey, { gw: 40 });
  let lastCol = 0, firstCol = 0;
  for (let y = 0; y < gh; y++) { lastCol += weights[y * gw + gw - 1]; firstCol += weights[y * gw]; }
  assert.ok(lastCol > 0, 'last column');
  assert.ok(weights[(gh >> 1) * gw + gw - 1] > 0, 'last column, mid row');
  assert.equal(weights.slice((gh - 1) * gw).reduce((a, b) => a + b, 0), 0, 'last row');
  assert.equal(firstCol, 0, 'first column (left feather)');
});
test('the entrance rushes on any scroll input except a lone modifier key', () => {
  for (const type of ['wheel', 'touchmove', 'scroll']) assert.equal(rushInput({ type }), true, type);
  for (const key of ['ArrowDown', 'PageDown', ' ', 'End', 'Tab', 'j']) assert.equal(rushInput({ type: 'keydown', key }), true, key);
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) assert.equal(rushInput({ type: 'keydown', key }), false, key);
});
test('bottom layout: the portrait slot follows the lead, is hidden outside the bottom layout and has the ruled height', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<p class="hero-lead">[^<]*<\/p>\s*<div class="hero-portrait-slot" aria-hidden="true"><\/div>\s*<ul class="hero-meta/);
  const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
  assert.match(css, /(^|\n)\.hero-portrait-slot\s*\{[^}]*display:\s*none;/);
  const shown = css.match(/\.portrait-bottom \.hero-portrait-slot\s*\{([^}]*)\}/);
  assert.ok(shown, 'a .portrait-bottom .hero-portrait-slot rule');
  assert.match(shown[1], /display:\s*block;/);
  assert.match(shown[1], /height:\s*clamp\(320px,\s*52svh,\s*560px\);/);
  assert.doesNotMatch(css, /var\(--bg\) 0 45%/, 'the 45% copy gradient is gone');
});

// Spec §8.3: the no-WebGL hero shows the cut-out as a static halftone where the portrait formation would be framed
// (framing.js: contained, centred, with the engine's 8% slack).
import { halftoneRect } from '../js/sections/hero.js';
test('the halftone portrait is the image aspect contained in the portrait rect with 8% slack, centred, whole px', () => {
  assert.deepEqual(halftoneRect({ x: 0, y: 0, w: 216, h: 108 }, 1), { x: 58, y: 4, w: 100, h: 100 });
  assert.deepEqual(halftoneRect({ x: 40, y: 80, w: 540, h: 1080 }, 2), { x: 60, y: 495, w: 500, h: 250 });
  const r = halftoneRect({ x: 532, y: 77, w: 444, h: 660 }, 1168 / 985);
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(r[k]), k);
});
