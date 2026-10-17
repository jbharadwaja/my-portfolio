import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jumpMode, railScrollFor, currentSection } from '../js/ui/scroll.js';
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
  const el = (id, top = 0) => {
    const node = {
      id, dataset: {}, style: {},
      getBoundingClientRect: () => ({ top: top - win.scrollY }),
      animate(keyframes, options) {
        const a = { el: node, options, cancelled: false, finished: Promise.resolve(), cancel() { a.cancelled = true; } };
        anims.push(a);
        return a;
      },
    };
    return node;
  };
  const sections = IDS.map((id, i) => el(id, i * 2 * innerHeight));
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
}
const fakeGsap = () => ({ ticker: { add() {}, lagSmoothing() {} } });

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
