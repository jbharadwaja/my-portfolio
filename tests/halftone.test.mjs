import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dotRadius, healAlpha, shouldRun, luminanceField } from '../js/ui/halftone-reveal.js';
test('dot radius', () => { assert.equal(dotRadius(1, 8), 0); assert.equal(dotRadius(0, 8), 4); });
test('heal', () => assert.ok(Math.abs(healAlpha(0.35) - (1 - Math.exp(-1))) < 1e-9));
test('sleeps when idle', () => {
  assert.equal(shouldRun({ inView: true, msSincePointer: 100, maskEmpty: true }), true);
  assert.equal(shouldRun({ inView: true, msSincePointer: 2000, maskEmpty: false }), true);
  assert.equal(shouldRun({ inView: true, msSincePointer: 2000, maskEmpty: true }), false);
  assert.equal(shouldRun({ inView: false, msSincePointer: 0, maskEmpty: false }), false);
});
test('dot radius is clamped at 0 and grows with darkness', () => {
  assert.equal(dotRadius(1.2, 8), 0);
  assert.ok(Math.abs(dotRadius(0.75, 8) - 2) < 1e-12);   // 8 · 0.5 · sqrt(0.25)
  assert.ok(dotRadius(0.2, 8) > dotRadius(0.6, 8));
});
test('the pointer window is 1.2 s', () => {
  assert.equal(shouldRun({ inView: true, msSincePointer: 1199, maskEmpty: true }), true);
  assert.equal(shouldRun({ inView: true, msSincePointer: 1200, maskEmpty: true }), false);
});
test('the plate caption names the gesture for both pointer kinds (spec §2.7)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<figcaption class="plate-caption mono">Grand Canyon, AZ<span class="plate-hint plate-hint-fine"> · move to reveal<\/span><span class="plate-hint plate-hint-touch"> · tap to reveal<\/span><\/figcaption>/);
});
test('luminance: Rec. 709 weights, levels stretched over the opaque pixels', () => {
  // black, white and a mid grey (all opaque): the 2nd/98th percentiles are black and white, so no stretch
  const lum = luminanceField(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 51, 102, 153, 255]));
  assert.ok(lum instanceof Float32Array);
  assert.equal(lum.length, 3);
  assert.equal(lum[0], 0);
  assert.equal(lum[1], 1);
  assert.ok(Math.abs(lum[2] - (0.2126 * 51 + 0.7152 * 102 + 0.0722 * 153) / 255) < 1e-6);
  // a low-contrast image is stretched to the full range
  const flatish = luminanceField(new Uint8ClampedArray([64, 64, 64, 255, 192, 192, 192, 255]));
  assert.equal(flatish[0], 0);
  assert.equal(flatish[1], 1);
});
test('luminance: transparent pixels read as paper (no dots), so a cut-out halftones only its subject', () => {
  const lum = luminanceField(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]));
  assert.equal(lum[0], 1);
  assert.equal(lum[3], 1);
  assert.equal(dotRadius(lum[0], 8), 0);
  assert.equal(lum[1], 0);
});

// prepare() never rejects (Ruling R59): a sampling failure (a tainted canvas, no 2D context) resolves start() to false.
import { createHalftoneReveal } from '../js/ui/halftone-reveal.js';
test('start() resolves false, never rejects, when sampling the image throws, and leaves the image showing', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const before = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData() { throw new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError'); },
      }),
    }),
  };
  t.after(() => { if (before === undefined) delete globalThis.document; else globalThis.document = before; });
  const img = { loading: 'lazy', naturalWidth: 788, naturalHeight: 985, style: { opacity: '' }, decode: () => Promise.resolve() };
  const reveal = createHalftoneReveal({ canvas: { clientWidth: 400, clientHeight: 500 }, img });
  assert.equal(await reveal.start(), false);
  assert.equal(img.style.opacity, '');
  assert.equal(warned.mock.callCount(), 1);
});
