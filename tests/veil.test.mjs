import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { WEIGHTS, displayedProgress, cellsLit, stepLabel, realProgress, veil, fontSheetsApplied } from '../js/ui/veil.js';

test('weights sum to 1', () => assert.ok(Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9));
test('soft creep', () => assert.ok(Math.abs(displayedProgress(0, 2.5, 0) - 0.9 * (1 - Math.exp(-1))) < 1e-9));
test('never decreases', () => assert.equal(displayedProgress(0.3, 0.1, 0.5), 0.5));
test('real progress wins', () => assert.equal(displayedProgress(0.95, 0.1, 0.2), 0.95));
test('meter cells', () => { assert.equal(cellsLit(1), 32); assert.equal(cellsLit(0.999), 31); assert.equal(cellsLit(0), 0); });
test('step label', () => { assert.equal(stepLabel(0.24), 'denoising step 12 / 50'); assert.equal(stepLabel(0.01), 'denoising step 01 / 50'); });

test('displayed progress and meter stay inside their ranges', () => {
  assert.equal(displayedProgress(1.0000000000000002, 99, 0), 1);
  assert.equal(cellsLit(-0.2), 0);
  assert.equal(cellsLit(1.4), 32);
  assert.equal(stepLabel(0), 'denoising step 00 / 50');
  assert.equal(stepLabel(1), 'denoising step 50 / 50');
});

test('real progress is the weighted sum of the reported fractions', () => {
  assert.equal(realProgress({}, WEIGHTS), 0);
  assert.ok(Math.abs(realProgress({ fonts: 1 }, WEIGHTS) - 0.15) < 1e-9);
  assert.ok(Math.abs(realProgress({ fonts: 0.5, portrait: 1 }, WEIGHTS) - (0.075 + 0.2)) < 1e-9);
  const all = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, 1]));
  assert.ok(Math.abs(realProgress(all, WEIGHTS) - 1) < 1e-9);
});

test('dropping a key re-weights the rest to sum to 1', () => {
  const noCompile = { ...WEIGHTS };
  delete noCompile.compile;
  assert.ok(Math.abs(realProgress({ fonts: 1 }, noCompile) - 0.15 / 0.8) < 1e-9);
  const everythingElse = Object.fromEntries(Object.keys(noCompile).map((k) => [k, 1]));
  assert.ok(Math.abs(realProgress(everythingElse, noCompile) - 1) < 1e-9);
  assert.equal(realProgress({}, {}), 1);
});

test('veil.report and dropKey are safe in Node and ignore unknown keys', () => {
  assert.doesNotThrow(() => { veil.report('nope'); veil.report('fonts', 0.5); veil.dropKey('nope'); });
});

// The inline boot script, run against a stand-in DOM.
const bootSrc = readFileSync(new URL('../js/boot-inline.js', import.meta.url), 'utf8');

function boot() {
  const classes = new Set(['no-js']);
  const attrs = {};
  const events = [];
  const timers = [];
  const frames = [];
  const listeners = { doc: {}, win: {} };
  const banner = { hidden: true, textContent: '' };
  const veilEl = { setAttribute: (k, v) => { attrs[k] = v; } };
  const dom = { '.veil': veilEl, '.banner': banner };
  const links = [];
  const document = {
    documentElement: {
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
      },
    },
    querySelector: (sel) => dom[sel] ?? null,
    querySelectorAll: () => links,
    addEventListener: (type, fn) => { (listeners.doc[type] ||= []).push(fn); },
    dispatchEvent: (e) => { events.push(e.type); },
  };
  const win = {
    document,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
    requestAnimationFrame: (fn) => { frames.push(fn); },
    addEventListener: (type, fn, capture) => { (listeners.win[type] ||= []).push({ fn, capture }); },
    Event: class { constructor(type) { this.type = type; } },
  };
  win.window = win;
  vm.runInNewContext(bootSrc, win);
  return {
    win, classes, attrs, events, timers, frames, listeners, banner, dom, links,
    fireError: (target) => listeners.win.error.forEach(({ fn }) => fn({ target })),
  };
}

test('boot: swaps no-js for js and marks the page preload', () => {
  const b = boot();
  assert.ok(!b.classes.has('no-js'));
  assert.ok(b.classes.has('js'));
  assert.ok(b.classes.has('preload'));
  assert.equal(b.win.__veil.lifted, false);
});

test('boot: lift() adds veil-done, labels the veil Loaded and runs once', () => {
  const b = boot();
  b.win.__veil.lift();
  b.win.__veil.lift();
  assert.ok(b.classes.has('veil-done'));
  assert.equal(b.attrs['aria-label'], 'Loaded');
  assert.equal(b.win.__veil.lifted, true);
  assert.deepEqual([...b.events], ['veil:lift']);
});

test('boot: an 8 s timer lifts the veil', () => {
  const b = boot();
  const t = b.timers.find((x) => x.ms === 8000);
  assert.ok(t, 'setTimeout(…, 8000) registered');
  t.fn();
  assert.ok(b.classes.has('veil-done'));
  assert.equal(b.win.__veil.lifted, true);
});

test('boot: lift works as a bare callback, without a receiver', () => {
  const b = boot();
  const { lift } = b.win.__veil;
  lift();
  assert.equal(b.win.__veil.lifted, true);
});

function link(href, sheet) {
  const handlers = {};
  return {
    href, sheet, media: '', handlers,
    addEventListener: (type, fn) => { handlers[type] = fn; },
    removeAttribute(name) { if (name === 'media') this.media = ''; },
  };
}

test('boot: at the cap a stalled stylesheet stops blocking the page, is named, and re-applies on arrival', () => {
  const b = boot();
  const stalled = link('https://fonts.googleapis.com/css2?family=Archivo', null);
  const loaded = link('https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.css', {});
  b.links.push(stalled, loaded);
  b.timers.find((x) => x.ms === 8000).fn();
  assert.equal(stalled.media, 'print', 'a print-only sheet no longer blocks first paint or scripts');
  assert.equal(loaded.media, '', 'a loaded sheet is left alone');
  assert.match(b.banner.textContent, /fonts\.googleapis\.com/);
  assert.ok(!/more/.test(b.banner.textContent));
  assert.ok(b.classes.has('veil-done'));
  stalled.handlers.load.call(stalled);
  assert.equal(stalled.media, '', 'the sheet applies once it arrives');
  assert.equal(b.banner.hidden, true, 'and leaves the banner: it was slow, not failed (Task 4 deferred minor)');
  assert.equal(b.banner.textContent, '');
});

test('boot: at the cap a stylesheet that already failed is not reported twice', () => {
  const b = boot();
  const failed = link('https://x.test/dead.css', null);
  b.links.push(failed);
  b.fireError({ tagName: 'LINK', href: failed.href });
  b.timers.find((x) => x.ms === 8000).fn();
  assert.equal(failed.media, '');
  assert.ok(!/more/.test(b.banner.textContent));
});

test('boot: script and link load errors show a banner naming the URL and lift', () => {
  const b = boot();
  assert.ok(b.listeners.win.error.every((l) => l.capture === true), 'error listener is capture-phase');
  b.fireError({ tagName: 'LINK', href: 'https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.css' });
  assert.equal(b.banner.hidden, false);
  assert.match(b.banner.textContent, /https:\/\/cdn\.jsdelivr\.net\/npm\/lenis@1\.3\.26\/dist\/lenis\.css/);
  assert.ok(b.classes.has('veil-done'));
});

test('boot: a second failure keeps the first URL and counts the rest', () => {
  const b = boot();
  b.fireError({ tagName: 'SCRIPT', src: 'https://x.test/a.js' });
  b.fireError({ tagName: 'LINK', href: 'https://x.test/b.css' });
  assert.match(b.banner.textContent, /a\.js/);
  assert.match(b.banner.textContent, /\+1 more/);
});

// Review R70: main.js names an import still in flight at the lift; if it arrives later the page upgrades after all.
test('boot: clear(url) takes a named URL off the banner, and hides it once nothing is left', () => {
  const b = boot();
  const V = b.win.__veil;
  V.banner('https://x.test/three.js');
  V.banner('https://x.test/gsap.js');
  V.clear('https://x.test/three.js');
  assert.equal(b.banner.hidden, false);
  assert.equal(b.banner.textContent, 'Could not load https://x.test/gsap.js', 'the next one is named, with no count');
  V.clear('https://x.test/never-named.js');
  assert.equal(b.banner.textContent, 'Could not load https://x.test/gsap.js');
  V.clear('https://x.test/gsap.js');
  assert.equal(b.banner.hidden, true);
  assert.equal(b.banner.textContent, '');
  V.banner('https://x.test/late.css');
  assert.equal(b.banner.hidden, false, 'a later failure shows it again');
  assert.match(b.banner.textContent, /late\.css$/);
});

test('boot: errors that are not script/link loads are ignored', () => {
  const b = boot();
  b.fireError({ tagName: 'IMG', src: 'https://x.test/p.png' });
  b.fireError(undefined);
  b.fireError(b.win);
  assert.equal(b.banner.hidden, true);
  assert.ok(!b.classes.has('veil-done'));
});

test('boot: a failure before the body exists is painted at DOMContentLoaded', () => {
  const b = boot();
  delete b.dom['.banner'];
  delete b.dom['.veil'];
  b.fireError({ tagName: 'LINK', href: 'https://x.test/early.css' });
  assert.equal(b.banner.hidden, true);
  b.dom['.banner'] = b.banner;
  b.dom['.veil'] = { setAttribute: (k, v) => { b.attrs[k] = v; } };
  b.listeners.doc.DOMContentLoaded.forEach((fn) => fn());
  assert.equal(b.banner.hidden, false);
  assert.match(b.banner.textContent, /early\.css/);
  assert.equal(b.attrs['aria-label'], 'Loaded');
});

test('boot: preload is removed one frame after the window load event', () => {
  const b = boot();
  assert.ok(b.classes.has('preload'));
  b.listeners.win.load.forEach(({ fn }) => fn());
  assert.ok(b.classes.has('preload'), 'still on in the load handler itself');
  b.frames.forEach((fn) => fn());
  assert.ok(!b.classes.has('preload'));
});

// ---------------------------------------------------------------- fontSheetsApplied (Ruling R26)

// A font stylesheet as the page has it: media="print" with onload="this.media='all'" (registered at parse time, so it
// runs before any listener added later), and a `sheet` once parsed.
function fontLink({ sheet = null, media = 'print' } = {}) {
  const listeners = { load: [], error: [] };
  const el = {
    href: 'https://fonts.googleapis.com/css2?family=Archivo', sheet, media, listeners,
    addEventListener: (type, fn) => listeners[type].push(fn),
    /** The load event: the onload attribute flips the media, then the listeners run. */
    load() { el.sheet ??= {}; el.media = 'all'; listeners.load.splice(0).forEach((fn) => fn()); },
    fail() { listeners.error.splice(0).forEach((fn) => fn()); },
  };
  return el;
}

/** A stand-in document holding `links`; `flushes` counts the style flushes (getComputedStyle reads). */
function fontsDoc(links) {
  const doc = {
    flushes: 0,
    documentElement: {},
    querySelectorAll: (sel) => (sel.startsWith('link[rel="stylesheet"]') ? links : []),
  };
  doc.defaultView = { getComputedStyle: () => { doc.flushes++; return { fontFamily: 'Archivo' }; } };
  return doc;
}

/** Whether `p` has settled once every pending microtask and the current timers have run. */
const settledYet = (p) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 0))]);
const never = () => {};

test('font sheets: none pending (loaded and flipped to all, or no font links) resolves at once, after a style flush', async () => {
  const doc = fontsDoc([fontLink({ sheet: {}, media: 'all' }), fontLink({ sheet: {}, media: 'all' })]);
  assert.equal(await settledYet(fontSheetsApplied(doc, never)), true);
  assert.equal(doc.flushes, 1, 'the faces are registered before anyone asks for them');
  assert.equal(await settledYet(fontSheetsApplied(fontsDoc([]), never)), true);
});

test('font sheets: a parsed sheet still media="print" is pending until its load event has flipped it', async () => {
  const alone = fontLink({ sheet: {}, media: 'print' });    // `sheet` set, the onload not run yet
  const single = fontSheetsApplied(fontsDoc([alone]), never);
  assert.equal(await settledYet(single), false, 'a sheet in print media declares no faces the page can use');
  alone.load();
  assert.equal(await settledYet(single), true);
  assert.equal(alone.media, 'all');

  const parsed = fontLink({ sheet: {}, media: 'print' });
  const loading = fontLink();                               // not even parsed yet
  const doc = fontsDoc([parsed, loading]);
  const p = fontSheetsApplied(doc, never);
  parsed.load();
  assert.equal(await settledYet(p), false, 'the other sheet is still loading');
  loading.load();
  assert.equal(await settledYet(p), true);
  assert.equal(doc.flushes, 1);
});

test('font sheets: a sheet that fails counts as settled (the page keeps its fallback faces)', async () => {
  const failing = fontLink();
  const doc = fontsDoc([failing, fontLink({ sheet: {}, media: 'all' })]);
  const p = fontSheetsApplied(doc, never);
  assert.equal(await settledYet(p), false);
  failing.fail();
  assert.equal(await settledYet(p), true);
});

test('font sheets: the veil lifting settles it while a sheet is still pending; never rejects', async () => {
  let lift = null;
  const doc = fontsDoc([fontLink({ sheet: {}, media: 'print' })]);
  const p = fontSheetsApplied(doc, (cb) => { lift = cb; });
  assert.equal(await settledYet(p), false);
  assert.equal(typeof lift, 'function', 'it waits on the lift only while something is pending');
  lift();
  assert.equal(await settledYet(p), true);
  let asked = false;
  await fontSheetsApplied(fontsDoc([]), () => { asked = true; });
  assert.equal(asked, false, 'nothing pending: the lift is not waited on');
});
