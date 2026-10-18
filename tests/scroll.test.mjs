import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jumpMode, railScrollFor, currentSection, anchorAt, placeToRestore, offsetFor, resizeRefreshes } from '../js/ui/scroll.js';
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
import { createScroll, scrubFor, groundFill } from '../js/ui/scroll.js';

const IDS = ['top', 'encoder', 'training', 'work', 'route', 'about', 'contact'];

function fakePage({ innerHeight = 900 } = {}) {
  const listeners = {};
  const win = {
    scrollY: 0, innerHeight, innerWidth: 1440, scrollTo: ({ top }) => { win.scrollY = top; },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    fire: (type) => (listeners[type] ?? []).forEach((fn) => fn({ type })),
  };
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
  assert.equal(scroll.toAnchor({ id: 'route', fraction: 0 }), true);  // a saved place at the section's start
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
  assert.deepEqual(placeToRestore({ visit: 'reload', entry: { id: 'gone', fraction: 0.5 }, tab: 'garbage', hashId: 'route', ids }), { id: 'route', fraction: 0, land: true });
  assert.deepEqual(placeToRestore({ visit: 'reload', entry: { id: 'training', fraction: NaN }, tab: null, hashId: '', ids }), null);
});
test('a back/forward visit restores only its own entry\'s place, never the tab\'s newest one', () => {
  const ids = ['top', 'encoder', 'training', 'route'];
  const tab = { id: 'encoder', fraction: 0.2 };
  assert.deepEqual(placeToRestore({ visit: 'back_forward', entry: { id: 'route', fraction: 0.1 }, tab, hashId: '', ids }), { id: 'route', fraction: 0.1 });
  assert.equal(placeToRestore({ visit: 'back_forward', entry: null, tab, hashId: '', ids }), null);
  assert.deepEqual(placeToRestore({ visit: 'back_forward', entry: null, tab, hashId: 'route', ids }), { id: 'route', fraction: 0, land: true });
});
test('a fresh visit ignores saved places and lands where a jump to the #hash section lands', () => {
  const ids = ['top', 'route'];
  const saved = { id: 'route', fraction: 0.7 };
  assert.deepEqual(placeToRestore({ visit: 'navigate', entry: saved, tab: saved, hashId: 'route', ids }), { id: 'route', fraction: 0, land: true });
  assert.equal(placeToRestore({ visit: 'navigate', entry: saved, tab: saved, hashId: '', ids }), null);
  assert.equal(placeToRestore({ visit: undefined, entry: null, tab: null, hashId: 'nowhere', ids }), null);
});

// The jump event: the Route snaps its ground to the destination's while a cut has the page faded out.
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

// A change of prefers-reduced-motion re-runs the scroll setup at once (main.js, gsap.matchMedia).
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

// A live reduced-motion switch must also reach the scrub smoothing set when the sections were created.
test('a followed scrub takes no smoothing with Lenis and 0.3 s on native scroll, through every switch', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const st = { durations: [], scrubDuration(v) { this.durations.push(v); } };
  const scroll = createScroll({ reduced: true });
  scroll.followScrub(st);
  assert.deepEqual(st.durations, [0.3], 'native scroll before the libraries arrive');
  scroll.setReduced(false);
  scroll.attach({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} } });
  assert.deepEqual(st.durations.at(-1), true, 'Lenis smooths: the trigger follows the scroll directly');
  scroll.setReduced(true);
  assert.deepEqual(st.durations.at(-1), 0.3, 'switched to reduce: native scroll, 0.3 s');
  scroll.setReduced(false);
  assert.deepEqual(st.durations.at(-1), true, 'and back');
  const late = { durations: [], scrubDuration(v) { this.durations.push(v); } };
  scroll.followScrub(late);
  assert.deepEqual(late.durations, [true], 'a trigger followed while Lenis runs');
  assert.doesNotThrow(() => scroll.followScrub(null));
  assert.doesNotThrow(() => scroll.followScrub({}), 'a trigger without scrubDuration (an old gsap) is left as created');
});

test('scrubFor and groundFill', () => {
  assert.equal(scrubFor(true), true);
  assert.equal(scrubFor(false), 0.3);
  assert.equal(groundFill({ dataset: { ground: 'night' } }), 'var(--bg-dark)');
  assert.equal(groundFill({ dataset: { ground: 'paper' } }), 'var(--bg)');
  assert.equal(groundFill({ dataset: {} }), 'var(--bg)');
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

// The libraries can arrive (and .js-scroll lengthen the stages) while a cut is fading out.
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

// Lenis drops a scrollTo while it is stopped unless it is forced, and the
// scroll lock (an open overlay) stops it. A jump asked for while locked now lands, as it does on native scroll.
class StoppableLenis extends FakeLenis {
  scrollTo(y, opts = {}) {
    (this.calls ??= []).push({ y, ...opts });
    if (this.stopped && !opts.force) return;                          // Lenis 1.3: `(isStopped || isLocked) && !force`
    super.scrollTo(y);
  }
}
test('while the page is locked, glides, scrollTo and cuts still move the page (forced past the stopped Lenis)', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ Lenis: StoppableLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} }, reduced: false });
  scroll.lock();
  assert.equal(scroll.lenis.stopped, true);
  await scroll.jumpTo('encoder');                                     // adjacent: a glide
  assert.equal(page.win.scrollY, 2 * 900);
  scroll.scrollTo(2 * 2 * 900);                                        // a plain (smooth) scrollTo
  assert.equal(page.win.scrollY, 2 * 2 * 900);
  await scroll.jumpTo('contact');                                     // far: a cut (immediate)
  assert.equal(page.win.scrollY, 6 * 2 * 900);
  assert.ok(scroll.lenis.calls.every((c) => c.force === true), JSON.stringify(scroll.lenis.calls));
  scroll.unlock();
  assert.equal(scroll.lenis.stopped, false);
});

// ---------------------------------------------------------------- navigation, place-keeping and boot robustness

/** A ScrollTrigger stand-in with the refresh event (keepPlace listens to it). */
function fakeTrigger({ isTouch = 0 } = {}) {
  const on = {};
  return {
    isTouch,
    update() {},
    addEventListener: (type, fn) => { (on[type] ??= []).push(fn); },
    refresh: () => (on.refresh ?? []).forEach((fn) => fn()),
  };
}

/** Lays the fake page's sections out again: each `screens` viewports of `innerHeight` px tall. */
function relayout(page, { innerWidth = page.win.innerWidth, innerHeight, screens = 2 }) {
  page.win.innerWidth = innerWidth;
  page.win.innerHeight = innerHeight;
  page.sections.forEach((sec, i) => {
    sec.getBoundingClientRect = () => ({ top: i * screens * innerHeight - page.win.scrollY, height: screens * innerHeight });
  });
}

// The Route's start shows nothing yet, so a jump to it lands at its landing point.
test('a section with a landing point is reached there by a cut or a glide, and a #hash place lands there too', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} }, reduced: false });
  const routeTop = 4 * 2 * 900;
  scroll.setLanding('route', () => routeTop + 180);
  const seen = [];
  scroll.on('jump', (e) => seen.push(e));
  await scroll.jumpTo('route');                                       // from the hero: a cut
  assert.equal(page.win.scrollY, routeTop + 180);
  assert.deepEqual(seen.at(-1), { mode: 'cut', targetIndex: 4 });
  page.win.scrollTo({ top: 3 * 2 * 900 + 100 });                      // in #work: a glide
  await scroll.jumpTo('route');
  assert.equal(page.win.scrollY, routeTop + 180);
  assert.deepEqual(seen.at(-1), { mode: 'animate', targetIndex: 4 });
  page.win.scrollTo({ top: 0 });
  assert.equal(scroll.toAnchor({ id: 'route', fraction: 0, land: true }), true);   // a #route visit
  assert.equal(page.win.scrollY, routeTop + 180);
  assert.equal(scroll.toAnchor({ id: 'route', fraction: 0 }), true);  // a saved place keeps its own fraction
  assert.equal(page.win.scrollY, routeTop);
  scroll.setLanding('route', null);
  page.win.scrollTo({ top: 0 });
  await scroll.jumpTo('route');                                       // removed: the section's top again
  assert.equal(page.win.scrollY, routeTop);
});

// Lenis clamps to the page height it measured last, which the stages outgrow at boot for 250 ms.
class LimitedLenis extends FakeLenis {
  constructor() { super(); this.limit = 1000; this.resizes = 0; }
  resize() { this.resizes++; this.limit = 99999; }
  scrollTo(y) { super.scrollTo(Math.min(y, this.limit)); }
}
test('a scroll past the limit Lenis last measured re-measures it first, so a deep link near the end lands', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ Lenis: LimitedLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} }, reduced: false });
  scroll.scrollTo(500);
  assert.equal(scroll.lenis.resizes, 0, 'inside the limit: nothing to re-measure');
  assert.equal(scroll.toAnchor({ id: 'contact', fraction: 0 }), true);   // a #contact visit, a reload at Contact
  assert.equal(page.win.scrollY, 6 * 2 * 900);
  assert.equal(scroll.lenis.resizes, 1);
  scroll.lenis.limit = 1000;                                          // stale again
  page.win.scrollTo({ top: 5 * 2 * 900 });
  await scroll.jumpTo('contact');                                     // adjacent: a glide
  assert.equal(page.win.scrollY, 6 * 2 * 900);
  assert.equal(scroll.lenis.resizes, 2);
});

// Lenis skips a scroll to the place it believes the page is at; a ScrollTrigger refresh can move the page natively.
class TrackingLenis extends FakeLenis {
  constructor() { super(); this.limit = 99999; this.targetScroll = window.scrollY; this.isScrolling = false; this.resizes = 0; }
  resize() { this.resizes++; this.targetScroll = window.scrollY; }
  scrollTo(y) {
    if (Math.round(y) === this.targetScroll) return;                 // Lenis 1.3: "if (target === this.targetScroll) return"
    this.targetScroll = Math.round(y);
    super.scrollTo(y);
  }
}
test('a page moved behind Lenis\'s back is re-read before a scroll, so a scroll back to Lenis\'s old place still runs', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const scroll = createScroll({ Lenis: TrackingLenis, gsap: fakeGsap(), ScrollTrigger: { update() {} }, reduced: false });
  scroll.scrollTo(3916, { immediate: true });
  assert.equal(scroll.lenis.resizes, 0);
  page.win.scrollTo({ top: 0 });                                       // a refresh measuring from the top, natively
  scroll.scrollTo(3916, { immediate: true });
  assert.equal(page.win.scrollY, 3916);
  assert.equal(scroll.lenis.resizes, 1);
  scroll.lenis.isScrolling = 'smooth';                                 // mid-glide Lenis's target is ahead on purpose
  scroll.lenis.targetScroll = 5000;
  scroll.scrollTo(4200, { immediate: true });
  assert.equal(scroll.lenis.resizes, 1);
});

test('inside a held stage the anchor carries the stage\'s progress; offsetFor prefers it while the stage holds', () => {
  const tops = [0, 900, 3600];
  const heights = [900, 2700, 900];
  const ranges = [0, 1800, 0];
  assert.deepEqual(anchorAt(tops, heights, 900 + 450, ranges), { index: 1, fraction: 450 / 2700, progress: 0.25 });
  assert.deepEqual(anchorAt(tops, heights, 900 + 2000, ranges), { index: 1, fraction: 2000 / 2700 }, 'past the hold: the stage scrolls out');
  assert.deepEqual(anchorAt(tops, heights, 300, ranges), { index: 0, fraction: 1 / 3 });
  assert.equal(offsetFor({ fraction: 450 / 2700, progress: 0.25 }, 2100, 1500), 375, 'the progress, through the new hold');
  assert.equal(offsetFor({ fraction: 0.5, progress: 0.25 }, 2000, 0), 1000, 'no hold (native scroll): the fraction');
  assert.equal(offsetFor({ fraction: 0.5 }, 2000, 1500), 1000);
  assert.equal(offsetFor({ fraction: 2 }, 2000, 0), 2000);
});

test('resizeRefreshes: any size change, except a touch-only URL-bar height change under 25%', () => {
  const a = { w: 390, h: 844 };
  assert.equal(resizeRefreshes(a, { w: 390, h: 844 }, false), false);
  assert.equal(resizeRefreshes(a, { w: 390, h: 800 }, false), true);
  assert.equal(resizeRefreshes(a, { w: 390, h: 760 }, true), false, 'the URL bar');
  assert.equal(resizeRefreshes(a, { w: 844, h: 390 }, true), true, 'a rotation');
  assert.equal(resizeRefreshes(a, { w: 390, h: 500 }, true), true, 'the keyboard, say: over 25%');
});

// Rotating a phone or resizing a window keeps the reader's place.
test('after a resize the first refresh puts the reader back in the same section at the same place', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const st = fakeTrigger();
  createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: st, reduced: false });
  st.refresh();                                                       // the boot refresh: the layout places read against
  page.win.scrollTo({ top: 2 * 1800 + 450 });                         // a quarter of the way into #training
  page.win.fire('scroll');
  relayout(page, { innerWidth: 844, innerHeight: 390 });              // the phone turns: every section is 780 px now
  page.win.fire('resize');
  page.win.scrollTo({ top: 3 * 1800 }); page.win.fire('scroll');      // a clamp or scroll anchoring, in the new layout
  st.refresh();
  assert.equal(page.win.scrollY, 2 * 780 + 195, 'a quarter of the way into the new #training');
  page.win.scrollTo({ top: 5 * 780 }); page.win.fire('scroll');       // read against the new layout from here on
  relayout(page, { innerWidth: 390, innerHeight: 844 });
  page.win.fire('resize');
  st.refresh();
  assert.equal(page.win.scrollY, 5 * 1688, 'back at the start of #about');
});

test('a held stage keeps its progress through a resize; a refresh without a resize moves nothing; a jump is left alone', async (t) => {
  const page = fakePage();
  onFakePage(t, page);
  page.doc.documentElement.classList = { contains: (c) => c === 'js-scroll' };
  const pin = page.sections[3];                                       // #work: 2 screens tall, its stage one screen
  pin.classList = { contains: (c) => c === 'pin' };
  pin.querySelector = () => ({ getBoundingClientRect: () => ({ height: page.win.innerHeight }) });
  const st = fakeTrigger();
  const scroll = createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: st, reduced: false });
  st.refresh();
  page.win.scrollTo({ top: 3 * 1800 + 450 }); page.win.fire('scroll');   // half way through the rail's hold
  assert.deepEqual(scroll.anchor(), { id: 'work', fraction: 0.25, progress: 0.5 });
  relayout(page, { innerWidth: 844, innerHeight: 390, screens: 3 });     // a wider rail: three screens tall now
  page.win.fire('resize');
  st.refresh();
  assert.equal(page.win.scrollY, 3 * 1170 + 0.5 * 780, 'half way through the new hold');
  page.win.scrollTo({ top: 1234 }); page.win.fire('scroll');
  st.refresh();                                                          // fonts, a late library: no resize
  assert.equal(page.win.scrollY, 1234);
  page.win.scrollTo({ top: 0 }); page.win.fire('scroll');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  for (const node of [page.doc.querySelector('main'), page.doc.getElementById('scene')]) {
    node.animate = () => ({ finished: gate, cancel() {} });
  }
  const jump = scroll.jumpTo('contact');                                 // a cut, still fading out …
  await new Promise((resolve) => setTimeout(resolve, 0));
  relayout(page, { innerWidth: 390, innerHeight: 844, screens: 2 });
  page.win.fire('resize');
  page.win.scrollTo({ top: 777 });
  st.refresh();                                                          // … when the resize refresh lands
  assert.equal(page.win.scrollY, 777, 'no restore under a running jump');
  release();
  await jump;
  assert.equal(page.win.scrollY, 6 * 1688, 'the jump measured its own target');
});

test('a touch-only URL-bar resize is not a resize ScrollTrigger refreshes for: scrolling keeps reading', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const st = fakeTrigger({ isTouch: 1 });
  createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: st, reduced: false });
  relayout(page, { innerWidth: 390, innerHeight: 844 });
  st.refresh();
  page.win.innerHeight = 780;                                           // the URL bar shows; the layout stays
  page.win.fire('resize');
  page.win.scrollTo({ top: 3000 }); page.win.fire('scroll');
  st.refresh();
  assert.equal(page.win.scrollY, 3000);
});

test('a live reduced-motion switch holds the place for the refresh that follows it', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const st = fakeTrigger();
  const scroll = createScroll({ Lenis: FakeLenis, gsap: fakeGsap(), ScrollTrigger: st, reduced: false });
  st.refresh();
  page.win.scrollTo({ top: 2 * 1800 + 900 }); page.win.fire('scroll');
  scroll.setReduced(true);
  page.win.scrollTo({ top: 0 });                                        // gsap.matchMedia's refresh measures from the top
  st.refresh();
  assert.equal(page.win.scrollY, 2 * 1800 + 900);
});

test('the scroll lock keeps the scrollbar\'s gutter while it hides the scrollbar, or pads the page by its width', (t) => {
  const page = fakePage();
  onFakePage(t, page);
  const html = page.doc.documentElement;
  html.style.setProperty = (k, v) => { html.style[k] = v; };
  html.style.removeProperty = (k) => { delete html.style[k]; };
  // A classic 15 px scrollbar, in a browser that does not keep the gutter: hiding it widens the page.
  let keepsGutter = false;
  Object.defineProperty(page.doc.body, 'clientWidth', { get: () => (html.style.overflow === 'hidden' && !keepsGutter ? 1440 : 1425) });
  const scroll = createScroll({ reduced: false });
  scroll.lock();
  assert.deepEqual([html.style.overflow, html.style.scrollbarGutter, html.style.paddingRight], ['hidden', 'stable', '15px']);
  assert.equal(html.style['--lock-gap'], '15px', 'the fixed header takes the same gap');
  scroll.unlock();
  assert.deepEqual([html.style.overflow, html.style.scrollbarGutter, html.style.paddingRight], ['', '', '']);
  assert.equal(html.style['--lock-gap'], undefined);
  // One that keeps it (or overlay scrollbars): nothing to pad.
  keepsGutter = true;
  scroll.lock();
  assert.deepEqual([html.style.scrollbarGutter, html.style.paddingRight], ['stable', '']);
  scroll.unlock();
});
