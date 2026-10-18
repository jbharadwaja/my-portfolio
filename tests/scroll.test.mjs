import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jumpMode, railScrollFor, currentSection, anchorAt, placeToRestore } from '../js/ui/scroll.js';
test('adjacent jumps animate, far jumps cut', () => {
  assert.equal(jumpMode(0, 1), 'animate'); assert.equal(jumpMode(4, 3), 'animate');
  assert.equal(jumpMode(0, 2), 'cut'); assert.equal(jumpMode(6, 0), 'cut');
});
const geo = { stStart: 1000, stEnd: 3000, cardWidth: 400, innerWidth: 1000, railTravel: 2800 };
test('first card centred at the rail start', () => assert.equal(railScrollFor({ ...geo, cardLeft: 300 }), 1000));
test('last card centred at the rail end', () => assert.equal(railScrollFor({ ...geo, cardLeft: 300 + 2800 }), 3000));
test('clamped beyond the ends', () => assert.equal(railScrollFor({ ...geo, cardLeft: 9999 }), 3000));
test('current section by viewport centre', () => assert.equal(currentSection([0, 900, 2700, 5400], 3000), 2));

test('a jump within the same section animates', () => assert.equal(jumpMode(3, 3), 'animate'));
test('a section is current from the moment its top reaches the line', () => {
  const tops = [0, 900, 2700, 5400];
  assert.equal(currentSection(tops, 899.5), 0);
  assert.equal(currentSection(tops, 900), 1);
  assert.equal(currentSection(tops, 99999), 3);
  assert.equal(currentSection(tops, -50), 0);
});
test('clamped before the first card, and a rail with no travel stays at its start', () => {
  assert.equal(railScrollFor({ ...geo, cardLeft: -500 }), 1000);
  assert.equal(railScrollFor({ ...geo, cardLeft: 300, railTravel: 0 }), 1000);
});
test('an anchor is the section at the viewport top and the fraction scrolled through it', () => {
  const tops = [0, 900, 2700, 5400];
  const heights = [900, 1800, 2700, 900];
  assert.deepEqual(anchorAt(tops, heights, 0), { index: 0, fraction: 0 });
  assert.deepEqual(anchorAt(tops, heights, 1800), { index: 1, fraction: 0.5 });
  assert.deepEqual(anchorAt(tops, heights, 2700), { index: 2, fraction: 0 });
  assert.deepEqual(anchorAt(tops, heights, 99999), { index: 3, fraction: 1 });   // past the last section (the footer)
  assert.deepEqual(anchorAt(tops, [900, 0, 2700, 900], 900), { index: 1, fraction: 0 });   // a collapsed section
});
test('scroll.js imports no library (it loads in Node, so nothing touches the DOM at load)', () => {
  const src = readFileSync(new URL('../js/ui/scroll.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\b/m);
});

// createScroll against a minimal fake page: just what scroll.js reads (no DOM library, no network).
import { createScroll } from '../js/ui/scroll.js';

const IDS = ['top', 'encoder', 'training', 'work', 'route', 'about', 'contact'];

function fakePage({ innerHeight = 900 } = {}) {
  const win = { scrollY: 0, innerHeight, scrollTo: ({ top }) => { win.scrollY = top; } };
  const anims = [];
  const el = (id, top = 0, height = 0) => {
    const node = {
      id, dataset: {}, style: {},
      getBoundingClientRect: () => ({ top: top - win.scrollY, height }),
      animate(keyframes, options) {
        const a = { el: node, options, cancelled: false, finished: Promise.resolve(), cancel() { a.cancelled = true; } };
        anims.push(a);
        return a;
      },
    };
    return node;
  };
  const sections = IDS.map((id, i) => el(id, i * 2 * innerHeight, 2 * innerHeight));
  const main = el('main');
  const scene = el('scene');
  const byId = Object.fromEntries([...sections, main, scene].map((n) => [n.id, n]));
  const doc = {
    documentElement: el('html'),
    body: el('body'),
    querySelector: (sel) => (sel === 'main' ? main : null),
    querySelectorAll: (sel) => (sel === 'main > section' ? sections : []),
    getElementById: (id) => byId[id] ?? null,
  };
  // A layer is held invisible while one of the cut's fill:'forwards' fade-outs on it is still in effect.
  const faded = () => anims.filter((a) => a.options.fill === 'forwards' && !a.cancelled).map((a) => a.el.id);
  return { win, doc, sections, faded };
}

function onFakePage(t, page) {
  const saved = ['window', 'document', 'requestAnimationFrame'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  globalThis.window = page.win;
  globalThis.document = page.doc;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  t.after(() => {
    for (const [k, d] of saved) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k];
  });
}

class FakeLenis {
  constructor() { this.stopped = false; this.handlers = []; FakeLenis.last = this; }
  on(_event, fn) { this.handlers.push(fn); }
  raf() {}
  stop() { this.stopped = true; }
  start() { this.stopped = false; }
  scrollTo(y) { window.scrollTo({ top: y }); this.handlers.forEach((fn) => fn()); }   // the immediate emit runs ScrollTrigger
  destroy() { this.destroyed = true; }
}
const fakeGsap = () => ({
  ticker: { callbacks: new Set(), add(fn) { this.callbacks.add(fn); }, remove(fn) { this.callbacks.delete(fn); }, lagSmoothing() {} },
});

test('a ScrollTrigger callback throwing mid-cut still leaves the page visible, and the jump queue keeps working', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const logged = t.mock.method(console, 'error', () => {});
  let failing = true;
  const ScrollTrigger = { update: () => { if (failing) throw new Error('section onUpdate failed'); } };
  page.doc.documentElement.dataset.ground = 'night';
  const scroll = createScroll({ Lenis: null, gsap: null, ScrollTrigger, reduced: false });

  await scroll.jumpTo('contact');                                    // 6 sections away: a cut
  assert.equal(page.win.scrollY, 6 * 2 * 900);                       // the jump itself landed on #contact
  assert.deepEqual(page.faded(), []);
  assert.equal(page.doc.body.style.backgroundColor, '');
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /section onUpdate failed/);

  failing = false;
  await scroll.jumpTo('top');
  assert.equal(page.win.scrollY, 0);
  assert.deepEqual(page.faded(), []);
});

test('a throw inside Lenis\'s immediate scroll (its scroll emit) is cleaned up the same way', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  t.mock.method(console, 'error', () => {});
  const ScrollTrigger = { update: () => { throw new Error('section onToggle failed'); } };
  const scroll = createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger, reduced: false });
  await scroll.jumpTo('route');
  assert.ok(page.win.scrollY > 0);
  assert.deepEqual(page.faded(), []);
  assert.equal(page.doc.body.style.backgroundColor, '');
});

test('a native scroll upgrades in place when the libraries arrive, keeping a lock taken before', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ reduced: false });                   // nav is wired to this before the CDN settles
  assert.equal(scroll.lenis, null);
  scroll.lock();                                                     // the burger sheet opened on native scroll
  scroll.lock();                                                     // and a second holder
  assert.equal(page.doc.documentElement.style.overflow, 'hidden');

  scroll.attach({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} } });
  assert.equal(scroll.lenis, FakeLenis.last);
  assert.equal(scroll.lenis.stopped, true);                          // the held lock reaches Lenis
  scroll.unlock();
  assert.equal(scroll.lenis.stopped, true);
  assert.equal(page.doc.documentElement.style.overflow, 'hidden');
  scroll.unlock();
  assert.equal(scroll.lenis.stopped, false);
  assert.equal(page.doc.documentElement.style.overflow, '');
  scroll.unlock();                                                   // an extra unlock is harmless
  assert.equal(scroll.lenis.stopped, false);
});

test('under reduced motion the upgrade creates no Lenis, but cuts still update ScrollTrigger', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  let updates = 0;
  const scroll = createScroll({ reduced: true });
  scroll.attach({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update: () => { updates++; } } });
  assert.equal(scroll.lenis, null);
  await scroll.jumpTo('about');
  assert.equal(updates, 1);
  assert.deepEqual(page.faded(), []);
});

test('anchor() and toAnchor() put the page back in the same section at the same fraction, at once', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} }, reduced: false });
  page.win.scrollTo({ top: 2 * 2 * 900 + 450 });                     // a quarter of the way through #training
  assert.deepEqual(scroll.anchor(), { id: 'training', fraction: 0.25 });
  page.win.scrollTo({ top: 0 });
  assert.equal(scroll.toAnchor({ id: 'training', fraction: 0.25 }), true);
  assert.equal(page.win.scrollY, 2 * 2 * 900 + 450);
  assert.equal(scroll.toAnchor({ id: 'route', fraction: 0 }), true);  // a hash URL: the section's start
  assert.equal(page.win.scrollY, 4 * 2 * 900);
  assert.equal(scroll.toAnchor({ id: 'gone', fraction: 0.5 }), false);
  assert.equal(page.win.scrollY, 4 * 2 * 900);
});
test('a reload restores the tab\'s saved place (its own pagehide wrote it last), then its entry\'s, then the #hash section', () => {
  // Chrome keeps history.state across a reload but drops a replaceState made in the reload's pagehide, so after a
  // back/forward visit the entry can still hold an older place: the tab's copy is the fresh one.
  const ids = ['top', 'encoder', 'training', 'route'];
  const entry = { id: 'training', fraction: 0.4 };
  const tab = { id: 'encoder', fraction: 0.2 };
  assert.deepEqual(placeToRestore({ visit: 'reload', entry, tab, hashId: 'route', ids }), tab);
  assert.deepEqual(placeToRestore({ visit: 'reload', entry, tab: null, hashId: 'route', ids }), entry);
  assert.deepEqual(placeToRestore({ visit: 'reload', entry: { id: 'gone', fraction: 0.5 }, tab: 'garbage', hashId: 'route', ids }), { id: 'route', fraction: 0 });
  assert.deepEqual(placeToRestore({ visit: 'reload', entry: { id: 'training', fraction: NaN }, tab: null, hashId: '', ids }), null);
});
test('a back/forward visit restores only its own entry\'s place, never the tab\'s newest one', () => {
  const ids = ['top', 'encoder', 'training', 'route'];
  const tab = { id: 'encoder', fraction: 0.2 };
  assert.deepEqual(placeToRestore({ visit: 'back_forward', entry: { id: 'route', fraction: 0.1 }, tab, hashId: '', ids }), { id: 'route', fraction: 0.1 });
  assert.equal(placeToRestore({ visit: 'back_forward', entry: null, tab, hashId: '', ids }), null);
  assert.deepEqual(placeToRestore({ visit: 'back_forward', entry: null, tab, hashId: 'route', ids }), { id: 'route', fraction: 0 });
});
test('a fresh visit ignores saved places and lands at the #hash section\'s start', () => {
  const ids = ['top', 'route'];
  const saved = { id: 'route', fraction: 0.7 };
  assert.deepEqual(placeToRestore({ visit: 'navigate', entry: saved, tab: saved, hashId: 'route', ids }), { id: 'route', fraction: 0 });
  assert.equal(placeToRestore({ visit: 'navigate', entry: saved, tab: saved, hashId: '', ids }), null);
  assert.equal(placeToRestore({ visit: undefined, entry: null, tab: null, hashId: 'nowhere', ids }), null);
});

// The jump event (Ruling R59): the Route snaps its ground to the destination's while a cut has the page faded out.
test('a cut emits jump { mode: "cut", targetIndex } once the page has moved, while main and the canvas are faded out', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} }, reduced: false });
  page.win.scrollTo({ top: 4 * 2 * 900 + 300 });                     // in #route
  const seen = [];
  scroll.on('jump', (e) => seen.push({ ...e, scrollY: page.win.scrollY, faded: page.faded() }));
  await scroll.jumpTo('top');
  assert.deepEqual(seen, [{ mode: 'cut', targetIndex: 0, scrollY: 0, faded: ['main', 'scene'] }]);
});

test('an adjacent jump emits jump { mode: "animate", targetIndex }; a throwing listener is logged and the jump still runs', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const logged = t.mock.method(console, 'error', () => {});
  const scroll = createScroll({ Lenis: null, gsap: null, ScrollTrigger: { update() {} }, reduced: false });
  const seen = [];
  scroll.on('jump', () => { throw new Error('listener failed'); });
  scroll.on('jump', (e) => seen.push(e));
  await scroll.jumpTo('encoder');
  assert.deepEqual(seen, [{ mode: 'animate', targetIndex: 1 }]);
  assert.equal(page.win.scrollY, 2 * 900);
  assert.equal(logged.mock.callCount(), 1);
  await scroll.jumpTo('contact');
  assert.deepEqual(seen.at(-1), { mode: 'cut', targetIndex: 6 });
  assert.equal(page.win.scrollY, 6 * 2 * 900);
  assert.deepEqual(page.faded(), []);
});

// Rulings R27/R45: a change of prefers-reduced-motion re-runs the scroll setup at once (main.js, gsap.matchMedia).
test('setReduced(true) destroys Lenis and scrolls natively; setReduced(false) creates a new one', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const gsap = fakeGsap();
  const scroll = createScroll({ Lenis: FakeLenis, gsap, ScrollTrigger: { update() {} }, reduced: false });
  const first = scroll.lenis;
  assert.ok(first);
  assert.equal(gsap.ticker.callbacks.size, 1);
  scroll.setReduced(true);
  assert.equal(scroll.lenis, null);
  assert.equal(first.destroyed, true);
  assert.equal(gsap.ticker.callbacks.size, 0, 'its raf callback left the ticker');
  scroll.setReduced(true);                                           // idempotent
  scroll.setReduced(false);
  assert.ok(scroll.lenis && scroll.lenis !== first);
  assert.equal(gsap.ticker.callbacks.size, 1);
});

test('setReduced before the libraries arrive decides whether attach() creates Lenis; a held lock reaches it', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ reduced: true });
  scroll.setReduced(false);
  assert.equal(scroll.lenis, null, 'nothing to create yet');
  scroll.lock();
  scroll.attach({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} } });
  assert.equal(scroll.lenis, FakeLenis.last);
  assert.equal(scroll.lenis.stopped, true);
  scroll.setReduced(true);
  scroll.setReduced(false);
  assert.equal(scroll.lenis.stopped, true, 'a Lenis recreated under the lock starts stopped');
});

test('under reduced motion set at runtime a cut fades out in 0 ms', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const durations = [];
  for (const node of [page.doc.querySelector('main'), page.doc.getElementById('scene')]) {
    node.animate = (keyframes, options) => {
      durations.push(options.duration);
      return { finished: Promise.resolve(), cancel() {} };
    };
  }
  const scroll = createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} }, reduced: false });
  scroll.setReduced(true);
  await scroll.jumpTo('contact');
  assert.deepEqual(durations.slice(0, 2), [0, 0]);
});

// Ruling R29: the libraries can arrive (and .js-scroll lengthen the stages) while a cut is fading out.
test('a cut measures its target once faded out, so a layout change mid-jump still lands on the section', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  for (const node of [page.doc.querySelector('main'), page.doc.getElementById('scene')]) {
    node.animate = () => ({ finished: gate, cancel() {} });
  }
  const scroll = createScroll({ reduced: false });
  const jump = scroll.jumpTo('contact');
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Mid-fade every section becomes three screens long.
  page.sections.forEach((s, i) => { s.getBoundingClientRect = () => ({ top: i * 3 * 900 - page.win.scrollY, height: 3 * 900 }); });
  release();
  await jump;
  assert.equal(page.win.scrollY, 6 * 3 * 900);
});
