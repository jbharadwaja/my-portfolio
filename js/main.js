// Boot orchestrator (spec §6.1 step 4). Own modules without a CDN dependency are imported statically;
// gsap, ScrollTrigger and Lenis load through await import() inside try/catch. If any of them fails the banner
// names it, scrolling stays native and .js-scroll is never set, so the sections keep their no-JS lengths.
// The veil lifts once the fonts are in and the hero is ready (portrait decoded, noise + portrait built, shaders
// compiled), or at the 8 s cap. The canvas first renders on the frame the veil starts fading.
// Debug flags: ?simulate=hang (never signals ready; the 8 s cap lifts the veil),
//              ?simulate=cdnfail (a CDN import fails: banner naming the URL, the veil still lifts).
import { veil } from './ui/veil.js';
import { createScroll, placeToRestore } from './ui/scroll.js';
import { initNav } from './ui/nav.js';
import { initHeroFit, initReveals } from './ui/split.js';
import { pickTier, readEnv } from './engine/tier.js';
import { mulberry32 } from './engine/formations/common.js';
import { buildNoise } from './engine/formations/noise.js';
import { buildGalaxy } from './engine/formations/galaxy.js';
import * as hero from './sections/hero.js';
import { SECTIONS, loadSections } from './sections/index.js';   // the six sections after the hero (it inits at boot)
import { createCursor } from './ui/cursor.js';
import { createConsole, readConsoleContext } from './ui/console.js';

/** Morph boundaries 0..1: B0 the entrance (0 at boot; hero.js runs or skips it), B1–B6 the section boundaries (spec §4.3). */
export const boundaries = new Float32Array(7);

const tickers = [];
let settleEngine;

/** Shared with every section module's init(ctx); filled during boot. */
export const ctx = {
  gsap: null,
  ScrollTrigger: null,
  scroll: null,
  tier: pickTier(readEnv(window)),   // once at load (spec §4.1)
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  boundaries,
  engine: null,
  /** Resolves to the engine once created (formations registered), or to null without WebGL or if it failed;
   *  never rejects. Section inits await this instead of reading ctx.engine, which is null until then. */
  engineReady: new Promise((resolve) => { settleEngine = resolve; }),
  /** fn(time, deltaTime) runs every GSAP tick, after Lenis and before the render. */
  onTick: (fn) => { tickers.push(fn); },
};

// One measuring trigger per boundary, in page order; the trigger is the incoming section (spec §4.3, §5.3).
const BOUNDARIES = [
  { trigger: '#encoder', start: 'top 70%' },
  { trigger: '#training' },
  { trigger: '#work' },
  { trigger: '#route' },
  { trigger: '#about' },
  { trigger: '#contact', end: 'clamp(top top)', snapEnd: 0.995 },
];

const simulate = new URLSearchParams(location.search).get('simulate');

/** Imports one CDN module; on failure the banner names its URL and the error is rethrown. */
async function load(specifier) {
  try {
    return await import(specifier);
  } catch (err) {
    window.__veil?.banner(import.meta.resolve(specifier));
    throw err;
  }
}

async function loadScrollLibs() {
  const gsapReady = Promise.all([load('gsap'), load('gsap/ScrollTrigger')]).then((mods) => {
    veil.report('gsap');
    return mods;
  });
  const lenisReady = load('lenis').then((mod) => {
    veil.report('lenis');
    return mod;
  });
  try {
    const [[{ gsap }, { ScrollTrigger }], { default: Lenis }] = await Promise.all([gsapReady, lenisReady]);
    return { gsap, ScrollTrigger, Lenis };
  } catch (err) {
    console.warn('Scroll libraries unavailable, using native scroll.', err);
    return null;
  }
}

/** three, then the engine on #scene; null without WebGL (the no-WebGL fallback is Task 17). */
async function loadEngine() {
  try {
    await load('three');
    veil.report('three');
    const { createEngine } = await import('./engine/scene.js');
    const engine = await createEngine({ canvas: document.getElementById('scene'), tier: ctx.tier, reduced: ctx.reduced });
    engine.state.boundaries = boundaries;
    registerFormations(engine);
    engine.pause();                    // nothing WebGL draws behind the veil (spec §6.1 Exit)
    veil.onLift(() => engine.resume());
    return engine;
  } catch (err) {
    console.warn('WebGL engine unavailable.', err);
    return null;
  }
}

/** Noise (0) is built before the veil lifts (the portrait, 1, is hero.js's); the galaxy (6) builds after it. */
function registerFormations(engine) {
  const { N } = ctx.tier;
  engine.registerFormation(0, () => buildNoise(N, { rng: mulberry32(0x4a42) }));
  engine.ensure(0).catch(() => {});   // a failed build is logged by the engine; the page carries on without it
  // Temporary: the galaxy also stands in at 2–5 and 7 so every morph can be seen; Tasks 10–15 register the real ones.
  for (const k of [2, 3, 4, 5, 6, 7]) engine.registerFormation(k, () => buildGalaxy(N, { rng: mulberry32(600 + k) }));
}

// Scroll restoration (Review Focus #2): the browser's own would restore into the no-JS layout and be wrong once
// .js-scroll lengthens the stages. So the place is saved as { section id, fraction through it } on pagehide, into
// this history entry's state (for back/forward) and the tab's sessionStorage (for a reload; which one wins is
// scroll.js placeToRestore). It is put back right after .js-scroll applies, and again once fonts, locked word
// widths and the hero's layout have settled (just before the veil lifts); a #hash lands at its section's start.
// The hero's entrance then sees where the page really is (hero.js entranceMode).
const PLACE_KEY = 'latent-space:place';
const PLACE_STATE = 'latentSpacePlace';
try {
  history.scrollRestoration = 'manual';
} catch { /* not supported: the browser restores on its own */ }
addEventListener('pagehide', () => {
  const here = ctx.scroll.anchor();
  try {
    const state = history.state && typeof history.state === 'object' ? history.state : null;
    history.replaceState({ ...state, [PLACE_STATE]: here }, '');
  } catch { /* history state unavailable: back/forward then starts at the top (or the #hash) */ }
  try {
    sessionStorage.setItem(PLACE_KEY, JSON.stringify(here));
  } catch { /* storage blocked: a reload starts at the top */ }
});

/** Read once at boot, before anything scrolls: where restorePlace() puts the page (null: leave it at the top). */
const place = (() => {
  const visit = performance.getEntriesByType?.('navigation')[0]?.type;
  let entry = null;
  let tab = null;
  let hashId = '';
  try {
    entry = history.state?.[PLACE_STATE] ?? null;
  } catch { /* history state unreadable */ }
  try {
    tab = JSON.parse(sessionStorage.getItem(PLACE_KEY));
  } catch { /* storage blocked or garbled */ }
  try {
    const id = decodeURIComponent(location.hash.slice(1));
    hashId = (id && document.getElementById(id)?.closest('main > section')?.id) || '';
  } catch { /* a malformed #hash */ }
  const ids = [...document.querySelectorAll('main > section')].map((s) => s.id);
  return placeToRestore({ visit, entry, tab, hashId, ids });
})();

function restorePlace() {
  if (place) ctx.scroll.toAnchor(place);
}

function createBoundaryTriggers(ScrollTrigger) {
  BOUNDARIES.forEach(({ trigger, start = 'top bottom', end = 'top top', snapEnd = 1 }, k) => {
    const i = k + 1;
    const write = (self) => { boundaries[i] = self.progress >= snapEnd ? 1 : self.progress; };
    ScrollTrigger.create({ trigger, start, end, onUpdate: write, onRefresh: write });
  });
}

// Native scroll, links, burger and HUD before anything is awaited: on a CDN slow past the 8 s cap (or hung), the
// page the cap reveals must still navigate. The libraries upgrade ctx.scroll in place when (if) they arrive.
ctx.scroll = createScroll({ reduced: ctx.reduced });
initNav(ctx);
initHeroFit();                // the hero name's fit needs no library
const heroReady = hero.init(ctx);   // starts decoding the portrait now; builds and compiles once the engine exists

// The engine loads alongside the scroll libraries and never holds them up; the ticker renders once it exists.
loadEngine().then((engine) => {
  ctx.engine = engine;
  settleEngine(engine);
});

if (simulate === 'cdnfail') {
  const url = 'https://cdn.jsdelivr.net/npm/three@0.0.0-nope/x.js';
  try {
    await import(url);
  } catch {
    window.__veil.banner(url);
  }
}

let laidOut = document.fonts.ready;   // with the libraries: settles once the word widths are locked (initReveals)
const libs = await loadScrollLibs();
if (libs) {
  const { gsap, ScrollTrigger, Lenis } = libs;
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add('js-scroll');
  ctx.gsap = gsap;
  ctx.ScrollTrigger = ScrollTrigger;
  ctx.scroll.attach({ Lenis, gsap, ScrollTrigger });
  restorePlace();
  gsap.ticker.add((time, deltaTime) => {
    for (const fn of tickers) fn(time, deltaTime);
    ctx.engine?.tick(time * 1000);   // render last (spec §4.7: lenis.raf → section state → render)
  });
  createBoundaryTriggers(ScrollTrigger);
  // The sections after the hero: all six modules load at once, then init in page order; one that fails is logged
  // and the rest still initialise.
  await loadSections(SECTIONS, (name) => import(`./sections/${name}.js`), ctx, console.error);
  try {
    laidOut = initReveals(ctx);   // settles after the word widths are locked
  } catch (err) {
    console.error(err);
  }
  laidOut.then(() => ScrollTrigger.refresh());
} else {
  restorePlace();
}

// The custom cursor and the ~ console (spec §6.3–6.4), after the sections whose DOM they read and drive; with or
// without the scroll libraries. Either one failing leaves the other (and the page) working.
for (const start of [
  () => createCursor({ root: document.body }),
  () => createConsole({ root: document.getElementById('console'), scroll: ctx.scroll, ctx: readConsoleContext(document) }),
]) {
  try {
    start();
  } catch (err) {
    console.error(err);
  }
}

// After the lift, by any route (the meter, the 8 s cap, an asset error), the other formations build in idle tasks.
veil.onLift(() => ctx.engineReady.then((engine) => engine?.buildDeferred()));
await document.fonts.ready;
await heroReady;
await laidOut;
// Late font swaps, the locked word widths and the hero's portrait slot can all have moved the sections since the
// first restore: put the page back at the same place while the veil still hides it.
if (!window.__veil?.lifted) restorePlace();
if (simulate === 'hang') await new Promise(() => {});
await veil.liftWhenReady();
