// Boot orchestrator (spec §6.1 step 4). Own modules without a CDN dependency are imported statically;
// gsap, ScrollTrigger and Lenis load through await import() inside try/catch. If any of them fails the banner
// names it, scrolling stays native and .js-scroll is never set, so the sections keep their no-JS lengths.
// Debug flags: ?simulate=hang (never signals ready; the 8 s cap lifts the veil),
//              ?simulate=cdnfail (a CDN import fails: banner naming the URL, the veil still lifts).
import { veil } from './ui/veil.js';
import { createScroll } from './ui/scroll.js';
import { initNav } from './ui/nav.js';
import { initHeroFit, initReveals } from './ui/split.js';

/** Morph boundaries 0..1: B0 the entrance, B1–B6 the section boundaries (spec §4.3). */
export const boundaries = new Float32Array(7);

const tickers = [];

/** Shared with every section module's init(ctx); filled during boot. */
export const ctx = {
  gsap: null,
  ScrollTrigger: null,
  scroll: null,
  tier: null,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  engine: null,
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
