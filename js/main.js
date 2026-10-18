// Boot orchestrator (spec §6.1 step 4). Own modules without a CDN dependency are imported statically;
// gsap, ScrollTrigger and Lenis load through await import() inside try/catch. If any of them fails the banner
// names it, scrolling stays native and .js-scroll is never set, so the sections keep their no-JS lengths.
// Debug flags: ?simulate=hang (never signals ready; the 8 s cap lifts the veil),
//              ?simulate=cdnfail (a CDN import fails: banner naming the URL, the veil still lifts).
import { veil } from './ui/veil.js';
import { createScroll } from './ui/scroll.js';
import { initNav } from './ui/nav.js';
import { initHeroFit, initReveals } from './ui/split.js';
import { pickTier, readEnv } from './engine/tier.js';
import { mulberry32 } from './engine/formations/common.js';
import { buildNoise } from './engine/formations/noise.js';
import { buildGalaxy } from './engine/formations/galaxy.js';

/** Morph boundaries 0..1: B0 the entrance, B1–B6 the section boundaries (spec §4.3). */
export const boundaries = new Float32Array(7);
boundaries[0] = 1;            // the entrance counts as done until the hero (Task 9) runs it

const tickers = [];
let settleEngine;

/** Shared with every section module's init(ctx); filled during boot. */
export const ctx = {
  gsap: null,
  ScrollTrigger: null,
  scroll: null,
  tier: pickTier(readEnv(window)),   // once at load (spec §4.1)
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  engine: null,
  /** Resolves to the engine once created (formations registered), or to null without WebGL or if it failed;
   *  never rejects. Section inits await this instead of reading ctx.engine, which is null until then. */
  engineReady: new Promise((resolve) => { settleEngine = resolve; }),
  /** fn(time, deltaTime) runs every GSAP tick, after Lenis and before the render. */
  onTick: (fn) => { tickers.push(fn); },
};

/** Section modules in page order; each exports init(ctx). */
const SECTIONS = [];

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
    return engine;
  } catch (err) {
    console.warn('WebGL engine unavailable.', err);
    return null;
  }
}

/** Noise (0) is built before the veil lifts; the galaxy (6) builds after it. */
function registerFormations(engine) {
  const { N } = ctx.tier;
  engine.registerFormation(0, () => buildNoise(N, { rng: mulberry32(0x4a42) }));
  engine.ensure(0).catch(() => {});   // a failed build is logged by the engine; the page carries on without it
  // Temporary: the galaxy also stands in at 1–5 and 7 so every morph can be seen; Tasks 9–15 register the real ones.
  for (const k of [1, 2, 3, 4, 5, 6, 7]) engine.registerFormation(k, () => buildGalaxy(N, { rng: mulberry32(600 + k) }));
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

const libs = await loadScrollLibs();
if (libs) {
  const { gsap, ScrollTrigger, Lenis } = libs;
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add('js-scroll');
  ctx.gsap = gsap;
  ctx.ScrollTrigger = ScrollTrigger;
  ctx.scroll.attach({ Lenis, gsap, ScrollTrigger });
  gsap.ticker.add((time, deltaTime) => {
    for (const fn of tickers) fn(time, deltaTime);
    ctx.engine?.tick(time * 1000);   // render last (spec §4.7: lenis.raf → section state → render)
  });
  createBoundaryTriggers(ScrollTrigger);
  for (const section of SECTIONS) await section.init(ctx);
  let laidOut = document.fonts.ready;
  try {
    laidOut = initReveals(ctx);   // settles after the word widths are locked
  } catch (err) {
    console.error(err);
  }
  laidOut.then(() => ScrollTrigger.refresh());
}

await document.fonts.ready;
if (simulate === 'hang') await new Promise(() => {});
await veil.liftWhenReady();
ctx.engineReady.then((engine) => engine?.buildDeferred());
