import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildName } from '../js/engine/formations/name.js';
import { mulberry32 } from '../js/engine/formations/common.js';
import { drawName, followRect, offsetRect, unionRect } from '../js/sections/signoff.js';
test('particles land inside the glyph mask', () => {
  const w = 100, h = 20, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 5; y < 15; y++) for (let x = 20; x < 80; x++) d.set([0, 0, 0, 255], (y * w + x) * 4);
  const N = 2000, f = buildName(N, { image: { width: w, height: h, data: d }, rng: mulberry32(9) });
  let inside = 0, dust = 0;
  for (let i = 0; i < N; i++) { if (f.data[i * 4 + 3] === -1) { dust++; continue; } const x = f.data[i * 4] / f.box.w + 0.5; if (x >= 0.19 && x <= 0.81) inside++; }
  assert.equal(dust, 300); assert.equal(inside, 1700);
});

// Two bars with a gap between them (an "I I"); the right one is drawn in grey `rightLum` at alpha `rightAlpha`.
const bars = (w, h, rightLum = 0, rightAlpha = 255) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 4; y < 16; y++) {
    for (let x = 20; x < 30; x++) d.set([0, 0, 0, 255], (y * w + x) * 4);
    for (let x = 70; x < 80; x++) d.set([rightLum, rightLum, rightLum, rightAlpha], (y * w + x) * 4);
  }
  return { width: w, height: h, data: d };
};
/** Share of the glyph particles in the right bar relative to the left, and how many fall in the gap between them. */
const barRatio = (image, N = 8000) => {
  const f = buildName(N, { image, rng: mulberry32(4) });
  let gap = 0, left = 0, right = 0;
  for (let i = 0; i < N; i++) {
    if (f.data[i * 4 + 3] === -1) continue;
    const x = f.data[i * 4] / f.box.w + 0.5, y = f.data[i * 4 + 1] / f.box.h + 0.5;
    assert.ok(y >= 0.2 - 1e-6 && y <= 0.8 + 1e-6);          // rows 4..16 of 20
    if (x < 0.3) left++; else if (x > 0.7) right++; else gap++;
  }
  return { gap, ratio: right / left };
};
test('the word keeps its shape: nothing lands in the gap between the letters', () => assert.equal(barRatio(bars(100, 20)).gap, 0));
test('an opaque bar is as dense at its edges as inside: no outline weighting', () => {
  const N = 20000, f = buildName(N, { image: bars(100, 20), rng: mulberry32(6) });
  let rim = 0, core = 0;
  for (let i = 0; i < N; i++) {
    if (f.data[i * 4 + 3] === -1) continue;
    const x = f.data[i * 4] / f.box.w + 0.5;
    if (x < 0.3) { if (x < 0.21 || x > 0.29) rim++; else core++; }
  }
  assert.ok(Math.abs(rim / 0.02 / (core / 0.08) - 1) < 0.1, `${rim} / ${core}`);   // per unit width, the rim is 0.02 of the 0.1-wide bar
});
test('weight follows coverage: a half-transparent bar is half as dense', () => assert.ok(Math.abs(barRatio(bars(100, 20, 0, 128)).ratio - 128 / 255) < 0.03));
test('formation shape: 4 floats each, the box follows the image, glyph meta 0, dust meta -1', () => {
  const N = 1000, f = buildName(N, { image: bars(100, 20), rng: mulberry32(1) });
  assert.equal(f.data.length, N * 4);
  assert.ok(Math.abs(f.box.w / f.box.h - 5) < 1e-9);
  assert.ok(f.minN >= 1 && f.minN <= 10000);
  for (let i = 0; i < N; i++) { const m = f.data[i * 4 + 3]; assert.ok(m === 0 || m === -1); if (m === 0) assert.equal(f.data[i * 4 + 2], 0); }
});
test('the same seed gives the same formation', () => {
  const a = buildName(500, { image: bars(100, 20), rng: mulberry32(8) });
  const b = buildName(500, { image: bars(100, 20), rng: mulberry32(8) });
  assert.deepEqual(a.data, b.data);
});

test('followRect holds the slot until the section top reaches the viewport top, then rides with the page', () => {
  const slot = { x: 120, y: 500, w: 1200, h: 240 };
  assert.deepEqual(followRect(slot, 400), slot);                         // section still below the top: held
  assert.deepEqual(followRect(slot, 0), slot);
  assert.deepEqual(followRect(slot, -70), { x: 120, y: 430, w: 1200, h: 240 });
  const out = { x: 0, y: 0, w: 0, h: 0 };
  assert.equal(followRect(slot, -10, out), out); assert.equal(out.y, 490);
});
test('offsetRect moves a rect down without touching the original', () => {
  const r = { x: 5, y: 10, w: 20, h: 30 };
  assert.deepEqual(offsetRect(r, 7), { x: 5, y: 17, w: 20, h: 30 });
  assert.deepEqual(offsetRect(r, -12), { x: 5, y: -2, w: 20, h: 30 });
  assert.deepEqual(r, { x: 5, y: 10, w: 20, h: 30 });
});
test('unionRect bounds the rects it is given and skips empty ones', () => {
  assert.deepEqual(unionRect([{ x: 10, y: 20, w: 100, h: 30 }, null, { x: 0, y: 60, w: 50, h: 10 }, { x: 5, y: 5, w: 0, h: 9 }]), { x: 0, y: 20, w: 110, h: 50 });
  assert.equal(unionRect([null, { x: 1, y: 1, w: 0, h: 0 }]), null);
});

test('drawName still draws when the font face fails to load (the fallback stack takes over)', async () => {
  // FontFaceSet.load rejects with a NetworkError when a declared face's file cannot be fetched.
  const fakeGl = () => ({
    measureText: () => ({ actualBoundingBoxLeft: 1, actualBoundingBoxRight: 99, actualBoundingBoxAscent: 40, actualBoundingBoxDescent: 0 }),
    fillText() {},
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  });
  const before = globalThis.document;
  globalThis.document = {
    fonts: { load: () => Promise.reject(new DOMException('A network error occurred.', 'NetworkError')) },
    createElement: () => ({ width: 0, height: 0, getContext: fakeGl }),
  };
  try {
    const image = await drawName();
    assert.equal(image.width, 104);       // 1 + 99 glyph width, plus 2 px of clear canvas each side
    assert.equal(image.height, 44);
  } finally {
    if (before === undefined) delete globalThis.document; else globalThis.document = before;
  }
});

// Once the morph has begun, every tick places the word and its keep-out. That must not
// read the layout (a rect per frame, and a forced layout after the last frame's writes): the section's page offset is
// measured at each ScrollTrigger refresh and the tick subtracts the scroll from it, as About does.
test('the sign-off places the word on each tick from the scroll alone; it reads the layout only on a refresh', async () => {
  const before = { document: globalThis.document, window: globalThis.window };
  const win = { scrollY: 0, innerHeight: 900 };
  let reads = 0;
  /** An element whose page box is `box` (page px): its client rect follows the scroll, and each read is counted. */
  const el = (box, extra = {}) => ({
    ...extra,
    getBoundingClientRect() {
      reads++;
      const top = box.y - win.scrollY;
      return { left: box.x, top, width: box.w, height: box.h, right: box.x + box.w, bottom: top + box.h };
    },
  });
  const SECTION = { x: 0, y: 9000, w: 1440, h: 1100 };
  const heading = el({ x: 48, y: 9168, w: 900, h: 140 });
  let drawn = false;                   // the word's aspect is set once the name is drawn (the last async step)
  const slot = el({ x: 115, y: 9500, w: 1210, h: 300 }, { style: { setProperty() { drawn = true; } }, setAttribute() {}, remove() {} });
  const inner = { children: [heading], append(node) { this.children.push(node); }, classList: { add() {}, remove() {} } };
  const section = el(SECTION, { querySelector: () => inner });
  const fakeGl = () => ({
    measureText: () => ({ actualBoundingBoxLeft: 1, actualBoundingBoxRight: 99, actualBoundingBoxAscent: 40, actualBoundingBoxDescent: 0 }),
    fillText() {},
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  });
  globalThis.window = win;
  globalThis.document = {
    getElementById: (id) => ({ contact: section, scene: { clientHeight: 900 } })[id] ?? null,
    querySelector: (selector) => (selector === '.site-footer' ? el({ x: 0, y: 10100, w: 1440, h: 70 }) : null),
    createElement: (tag) => (tag === 'div' ? slot : { width: 0, height: 0, getContext: fakeGl }),
    fonts: { load: () => Promise.resolve() },
  };
  try {
    const { init } = await import('../js/sections/signoff.js');
    let tick = null;
    const refreshers = [];
    let pose = null;
    const engine = { setSafeRects() {}, setPose(k, p) { pose = p; }, registerFormation() {} };
    const boundaries = new Float32Array(7);
    boundaries[6] = 1;
    await init({
      engineReady: Promise.resolve(engine),
      onTick: (fn) => { tick = fn; },
      boundaries,
      ScrollTrigger: { addEventListener: (type, fn) => refreshers.push(fn), refresh: () => refreshers.forEach((fn) => fn()) },
    });
    for (let i = 0; i < 50 && !(tick && pose && drawn); i++) await new Promise((r) => setImmediate(r));
    assert.ok(tick && pose && drawn, 'the sign-off wired its tick and its pose, and drew the name');
    const counted = reads;
    for (const y of [8800, 9000, 9100, 9400]) {
      win.scrollY = y;
      tick();
      // held at the slot's place until the section's top reaches the viewport's top, then riding with the page
      assert.equal(pose.rect().y, 500 + Math.min(0, SECTION.y - y), `scroll ${y}`);
    }
    assert.equal(reads, counted, 'no layout read on a tick');
    win.scrollY = 9050;
    refreshers.forEach((fn) => fn());
    assert.ok(reads > counted, 'a refresh measures');
    tick();
    assert.equal(pose.rect().y, 450);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
