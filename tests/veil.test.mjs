import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { WEIGHTS, displayedProgress, cellsLit, stepLabel, realProgress, veil } from '../js/ui/veil.js';

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
