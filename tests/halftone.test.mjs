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

// The touch auto-sweep under a live prefers-reduced-motion change (spec §3.3: no halftone auto-sweep under reduce,
// set up so it re-runs when the preference changes). A minimal DOM: 2D contexts that count the brush stamps (the
// sweep's only drawing), an IntersectionObserver the test drives, and a requestAnimationFrame queue it steps.
function fakeDom(t) {
  const names = ['document', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
    'devicePixelRatio', 'matchMedia', 'addEventListener'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => {
    for (const [name, d] of saved) {
      if (d) Object.defineProperty(globalThis, name, d);
      else delete globalThis[name];
    }
  });
  const dom = { stamps: 0, observers: [], byId: {} };
  const context = (c) => ({
    drawImage(src) { if (src.brush) dom.stamps++; },
    createRadialGradient() { c.brush = true; return { addColorStop() {} }; },   // only the brush has a gradient
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }),
    fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, arc() {}, fill() {},
  });
  dom.canvas = (props = {}) => {
    const c = { width: 0, height: 0, ...props, addEventListener() {}, removeEventListener() {} };
    let g = null;
    c.getContext = () => (g ??= context(c));
    return c;
  };
  dom.img = () => ({
    loading: 'lazy', naturalWidth: 788, naturalHeight: 985, style: { opacity: '' }, decode: () => Promise.resolve(),
  });
  let queue = [];
  let ids = 0;
  let clock = 0;
  dom.frames = (n, ms = 50) => {     // n frames, ms apart, on a clock that never runs backwards
    clock = Math.max(clock, performance.now());
    for (let i = 0; i < n; i++) {
      clock += ms;
      const run = queue;
      queue = [];
      for (const f of run) f.fn(clock);
    }
  };
  dom.view = (target, inView) => {
    const entry = {
      isIntersecting: inView,
      intersectionRatio: inView ? 1 : 0,
      intersectionRect: { height: inView ? 500 : 0 },
      rootBounds: { height: 800 },
    };
    for (const o of [...dom.observers]) if (o.targets.includes(target)) o.cb([entry]);
  };
  Object.assign(globalThis, {
    document: { createElement: () => dom.canvas(), getElementById: (id) => dom.byId[id] ?? null },
    IntersectionObserver: class {
      constructor(cb) { this.cb = cb; this.targets = []; dom.observers.push(this); }
      observe(el) { this.targets.push(el); }
      disconnect() { this.targets = []; }
    },
    requestAnimationFrame: (fn) => { queue.push({ id: ++ids, fn }); return ids; },
    cancelAnimationFrame: (id) => { queue = queue.filter((f) => f.id !== id); },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 1,
    matchMedia: (query) => ({ matches: query === '(hover: none)' }),   // a touch device
    addEventListener() {},
  });
  return dom;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('autoSweep() is asked when the sweep would start: refused, it stays pending; allowed, it plays once', async (t) => {
  const dom = fakeDom(t);
  const canvas = dom.canvas({ clientWidth: 400, clientHeight: 500 });
  let allow = false;
  const reveal = createHalftoneReveal({ canvas, img: dom.img(), interactive: true, autoSweep: () => allow });
  assert.equal(await reveal.start(), true);
  dom.view(canvas, true);
  dom.frames(20);
  assert.equal(dom.stamps, 0, 'no sweep while autoSweep() is false');
  dom.view(canvas, false);
  allow = true;
  dom.view(canvas, true);
  dom.frames(20);
  assert.ok(dom.stamps > 0, 'the sweep plays the next time the plate comes into view');
  dom.frames(120);                     // past the 3.6 s sweep: the wipe heals and the loop sleeps
  const played = dom.stamps;
  dom.view(canvas, false);
  dom.view(canvas, true);
  dom.frames(20);
  assert.equal(dom.stamps, played, 'one sweep only');
});

test('a sweep in progress stops on the frame autoSweep() turns false; a boolean autoSweep still works', async (t) => {
  const dom = fakeDom(t);
  const canvas = dom.canvas({ clientWidth: 400, clientHeight: 500 });
  let allow = true;
  const reveal = createHalftoneReveal({ canvas, img: dom.img(), interactive: true, autoSweep: () => allow });
  await reveal.start();
  dom.view(canvas, true);
  dom.frames(10);
  assert.ok(dom.stamps > 0);
  const before = dom.stamps;
  allow = false;                       // e.g. Reduce motion switched on mid-sweep
  dom.frames(60);
  assert.equal(dom.stamps, before);

  for (const [autoSweep, sweeps] of [[true, true], [false, false]]) {
    const c = dom.canvas({ clientWidth: 400, clientHeight: 500 });
    const from = dom.stamps;
    await createHalftoneReveal({ canvas: c, img: dom.img(), interactive: true, autoSweep }).start();
    dom.view(c, true);
    dom.frames(10);
    assert.equal(dom.stamps > from, sweeps, `autoSweep: ${autoSweep}`);
  }
});

test('About on touch: Reduce motion switched on after init means no auto-sweep; switched off, it plays (spec §3.3)', async (t) => {
  const dom = fakeDom(t);
  const canvas = dom.canvas({ clientWidth: 400, clientHeight: 500 });
  const img = dom.img();
  const plate = { querySelector: (s) => ({ '.plate-canvas': canvas, '.plate-img': img })[s] ?? null };
  const figure = { querySelector: (s) => (s === '.plate' ? plate : null), classList: { toggle() {} } };
  const section = { querySelector: (s) => (s === '.plate-figure' ? figure : null) };
  dom.byId.about = section;
  const ctx = { reduced: false, engineReady: Promise.resolve(null) };   // initialised under full motion
  const { init } = await import('../js/sections/about.js');
  await init(ctx);
  ctx.reduced = true;                  // what main.js's applyReduced does when the preference changes
  dom.view(section, true);             // About within 2 screens: the reveal starts
  await settle();
  dom.view(canvas, true);
  dom.frames(20);
  assert.equal(dom.stamps, 0, 'no halftone auto-sweep under reduced motion');
  ctx.reduced = false;
  dom.view(canvas, false);
  dom.view(canvas, true);
  dom.frames(20);
  assert.ok(dom.stamps > 0, 'the sweep follows the preference back');
});

// Task 19 contrast pass: About's copy scrolls through the held galaxy, whose arms reach under the muted skills and
// certifications (ink-60, 5.12:1 on bare paper) even at the keep-out's 12%; the copy block carries its own paper.
test('About: the copy block carries its own paper ground over the canvas (text >= 4.5:1)', () => {
  const css = readFileSync(new URL('../css/sections/about.css', import.meta.url), 'utf8');
  const rule = css.match(/(^|\n)\.about-text\s*\{([^}]*)\}/);
  assert.ok(rule, 'an .about-text rule');
  assert.match(rule[2], /background:\s*var\(--bg\);/);
});
