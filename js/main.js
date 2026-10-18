// Boot orchestrator (spec §6.1 step 4). Own modules without a CDN dependency are imported statically;
// three, gsap, ScrollTrigger and Lenis load through await import() inside try/catch, and nothing that works without
// them waits for them: the CV state, native scroll, nav, the hero's layout, the cursor and the ~ console are wired
// first (Ruling R65). If gsap or Lenis fails the banner names it, scrolling stays native and .js-scroll is never set,
// so the sections keep their no-JS lengths; the engine then renders from main.js's own rAF loop (Ruling R31), its
// canvas shown only while the hero fills the viewport (Ruling R68).
// Without WebGL — ?nowebgl, no webgl2 context, three or the engine failing, a context lost for good — the page shows
// its no-WebGL visuals (enterNoWebgl, spec §8.3); so does a veil lifted before the engine is ready, until it arrives
// and fades in (spec §6.1 late ready). prefers-reduced-motion is followed live (spec §3.3, Rulings R27/R45).
// The veil lifts once the fonts are in and the hero is ready (portrait decoded, noise + portrait built, shaders
// compiled), or at the 8 s cap. The canvas first renders on the frame the veil starts fading.
// Debug flags: ?nowebgl (the no-WebGL page), ?simulate=hang (never signals ready; the 8 s cap lifts the veil),
//              ?simulate=cdnfail (the gsap import fails: banner naming the URL, the veil still lifts, native scroll).
import { veil, fontsSettled } from './ui/veil.js';
import { createScroll, placeToRestore, groundFill } from './ui/scroll.js';
import { initNav } from './ui/nav.js';
import { initHeroFit, initReveals } from './ui/split.js';
import { pickTier, readEnv } from './engine/tier.js';
import { resolve as resolvePair, applyEntrance } from './engine/resolver.js';
import { mulberry32 } from './engine/formations/common.js';
import { buildNoise } from './engine/formations/noise.js';
import { buildGalaxy } from './engine/formations/galaxy.js';
import * as hero from './sections/hero.js';
import { SECTIONS, loadSections } from './sections/index.js';   // the six sections after the hero (it inits at boot)
import { createCursor } from './ui/cursor.js';
import { createConsole, readConsoleContext } from './ui/console.js';
import { CV_PUBLISHED, applyCvState } from './content.js';

const REDUCED = '(prefers-reduced-motion: reduce)';
const LATE_FADE_MS = 400;              // a late engine's canvas fades in (spec §6.1)
const LATE_BUILD_WAIT_MS = 1500;       // ...once the formations on screen are built, or after this long at most
const HERO_FADE_MS = 300;              // without gsap's ticker, the canvas fades as the hero leaves or returns (R68)
const FONT_REFRESH_MS = 150;           // after a late font's relayouts, ScrollTrigger re-measures (debounced)
const FAILING_GSAP = 'https://cdn.jsdelivr.net/npm/gsap@0.0.0-nope/index.js';   // ?simulate=cdnfail

/** Morph boundaries 0..1: B0 the entrance (0 at boot; hero.js runs or skips it), B1–B6 the section boundaries (spec §4.3). */
export const boundaries = new Float32Array(7);

const tickers = [];
let settleEngine;
const fallbacks = [];                  // { mount, unmount }: the no-WebGL visuals (spec §8.3)
let noWebgl = '';                      // why the page is in its no-WebGL state ('' while it is not)

/** Shared with every section module's init(ctx); filled during boot. */
export const ctx = {
  gsap: null,
  ScrollTrigger: null,
  scroll: null,
  tier: pickTier(readEnv(window)),   // once at load (spec §4.1)
  reduced: matchMedia(REDUCED).matches,   // follows the preference (applyReduced)
  boundaries,
  engine: null,
  /** Resolves to the engine once created (formations registered), or to null without WebGL or if it failed;
   *  never rejects. Section inits await this instead of reading ctx.engine, which is null until then. */
  engineReady: new Promise((resolve) => { settleEngine = resolve; }),
  /** fn(time, deltaTime) runs every GSAP tick, after Lenis and before the render; one that throws is dropped. */
  onTick: (fn) => { tickers.push(fn); },
  /**
   * Registers a no-WebGL visual: mount() runs whenever the page enters its no-WebGL state (at once if it is in it)
   * and may return an unmount, which runs if a late engine takes over (spec §6.1).
   */
  fallback(mount) {
    const entry = { mount, unmount: null };
    fallbacks.push(entry);
    if (noWebgl) mountFallback(entry);
  },
};

function mountFallback(entry) {
  try {
    entry.unmount = entry.mount() ?? null;
  } catch (err) {
    console.error(err);
  }
}

/**
 * The no-WebGL state (spec §8.3): <html class="no-webgl"> hides the canvas, every registered fallback mounts (the
 * hero's halftone portrait, the Route's 2D map; the encoder keeps its label grid) and ScrollTrigger re-measures.
 * `reason`: 'nowebgl' (the debug flag), 'webgl2' (no context), 'three' (its import failed), 'engine' (it could not
 * be created), 'contextfail' (lost for good) or 'late' (the veil lifted before the engine was ready). Already in
 * the state, only a 'late' one takes the new reason: a late engine whose context is lost for good before it has
 * taken over keeps the fallbacks (leaveNoWebgl then stops).
 */
export function enterNoWebgl(reason) {
  if (noWebgl) {
    if (noWebgl === 'late') noWebgl = reason;
    return;
  }
  noWebgl = reason;
  document.documentElement.classList.add('no-webgl');
  fallbacks.forEach(mountFallback);
  ctx.ScrollTrigger?.refresh();
}

/**
 * The engine arrived after the veil (spec §6.1 late ready): once the formations for the current scroll position are
 * built, the fallbacks go and the canvas fades in over 400 ms there (the entrance was skipped at the lift).
 */
async function leaveNoWebgl(engine) {
  await new Promise((resolve) => setTimeout(resolve, 0));   // the sections' engineReady callbacks register theirs
  const pair = resolvePair(applyEntrance(Float32Array.from(boundaries), boundaries[0]));
  const built = Promise.allSettled([engine.ensure(pair.from), engine.ensure(pair.to)]);
  await Promise.race([built, new Promise((resolve) => setTimeout(resolve, LATE_BUILD_WAIT_MS))]);
  if (noWebgl !== 'late') return;      // meanwhile the context was lost for good
  noWebgl = '';
  document.documentElement.classList.remove('no-webgl');
  for (const entry of fallbacks) {
    try {
      entry.unmount?.();
    } catch (err) {
      console.error(err);
    }
    entry.unmount = null;
  }
  // While the canvas fades in, the body holds the current ground (the Route's night too, whose own ground just went).
  const { body, documentElement: root } = document;
  body.style.backgroundColor = groundFill(root);
  const fade = document.getElementById('scene')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LATE_FADE_MS, easing: 'ease-out' });
  ctx.ScrollTrigger?.refresh();
  await fade?.finished.catch(() => {});
  body.style.backgroundColor = '';
}

// One measuring trigger per boundary, in page order; the trigger is the incoming section (spec §4.3, §5.3).
const BOUNDARIES = [
  { trigger: '#encoder', start: 'top 70%' },
  { trigger: '#training' },
  { trigger: '#work' },
  { trigger: '#route' },
  { trigger: '#about' },
  { trigger: '#contact', end: 'clamp(top top)', snapEnd: 0.995 },
];

const params = new URLSearchParams(location.search);
const simulate = params.get('simulate');

const loading = new Set();             // CDN module URLs still in flight
const named = new Set();               // URLs the banner names (still loading, or failed)

/** The banner names `url` as failed, or as still loading (`slow`); it shows each URL once (the boot script). */
function name(url, slow) {
  named.add(url);
  window.__veil?.[slow ? 'slow' : 'banner']?.(url);
}

/**
 * Imports one CDN module; on failure the banner names its URL and the error is rethrown. One the banner named while
 * it was still in flight (the lift) leaves it on arrival: the page upgrades after all.
 */
async function load(specifier) {
  const url = import.meta.resolve(simulate === 'cdnfail' && specifier === 'gsap' ? FAILING_GSAP : specifier);
  loading.add(url);
  try {
    const mod = await import(url);
    if (named.delete(url)) window.__veil?.clear?.(url);
    return mod;
  } catch (err) {
    name(url, false);
    throw err;
  } finally {
    loading.delete(url);
  }
}

// One still in flight when the veil lifts (the 8 s cap lifted it) is named as still loading, not as failed: the page
// works without it, and upgrades if it arrives (spec §6.1, §8.3).
veil.onLift(() => loading.forEach((url) => name(url, true)));

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

/** Whether a webgl2 context can be had at all: asked of a throwaway canvas, whose context is given back at once. */
function hasWebgl2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

/** three, then the engine on #scene; null without WebGL, the page then in its no-WebGL state (spec §8.3). */
async function loadEngine() {
  const without = (reason) => {
    veil.dropKey('three');
    enterNoWebgl(reason);
    return null;
  };
  if (params.has('nowebgl')) return without('nowebgl');
  if (!hasWebgl2()) return without('webgl2');
  try {
    await load('three');
  } catch {
    return without('three');
  }
  veil.report('three');
  try {
    const { createEngine } = await import('./engine/scene.js');
    const engine = await createEngine({ canvas: document.getElementById('scene'), tier: ctx.tier, reduced: ctx.reduced });
    engine.setReduced(ctx.reduced);    // the preference may have changed while it was being created
    engine.state.boundaries = boundaries;
    registerFormations(engine);
    engine.on('contextfail', () => enterNoWebgl('contextfail'));   // not restored within 3 s (spec §4.8)
    engine.pause();                    // nothing WebGL draws behind the veil (spec §6.1 Exit)
    veil.onLift(() => engine.resume());
    return engine;
  } catch (err) {
    console.warn('WebGL engine unavailable.', err);
    return without('engine');
  }
}

/**
 * The Route's no-WebGL map (spec §8.3). Its module is imported only here, when the page needs it, so neither it nor
 * the Route's own module sits in main.js's static graph: one of them failing to load costs the map, not the page.
 */
function mountRouteMap() {
  let unmount = null;
  let gone = false;
  import('./ui/fallback-map.js')
    .then(({ mountFallbackMap }) => {
      if (!gone) unmount = mountFallbackMap(document.getElementById('route'));
    })
    .catch((err) => console.error('The Route\'s 2D map failed to load.', err));
  return () => {
    gone = true;
    unmount?.();
  };
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
// scroll.js placeToRestore). It is put back at boot on the native layout, right after .js-scroll applies, and again
// once fonts, locked word widths and the hero's layout have settled (just before the veil lifts); a #hash lands at
// its section's start. The hero's entrance then sees where the page really is (hero.js entranceMode).
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

/** prefers-reduced-motion changed (spec §3.3): Lenis, the engine's motion, and what the sections read from ctx. */
function applyReduced(on) {
  ctx.reduced = on;
  ctx.scroll.setReduced(on);
  ctx.engine?.setReduced(on);
}

// Everything that needs no library, before anything is awaited: on a CDN slow past the 8 s cap (or hung), the page
// the cap reveals must still navigate, show its CV links, cursor and console. The libraries upgrade ctx.scroll in
// place when (if) they arrive.
applyCvState(document, CV_PUBLISHED);
ctx.scroll = createScroll({ reduced: ctx.reduced });
initNav(ctx);
initHeroFit();                // the hero name's fit needs no library
const heroReady = hero.init(ctx);   // lays the hero out and starts decoding the portrait now; builds once the engine exists
ctx.fallback(mountRouteMap);
// The custom cursor and the ~ console (spec §6.3–6.4). Either one failing leaves the other (and the page) working.
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
const reducedQuery = matchMedia(REDUCED);
const followReduced = (e) => applyReduced(e.matches);
reducedQuery.addEventListener('change', followReduced);   // until gsap.matchMedia takes over (for good without gsap)

// The engine loads alongside the scroll libraries and never holds them up. It renders at the end of the GSAP ticker
// once gsap is there (spec §4.7); until then, and for good if gsap fails, from this rAF loop, with the boundaries
// left at 0: the hero portrait stays (Ruling R31; heroGate shows it only in the hero). Both pass performance.now(),
// so the hand-over keeps one clock.
let ownLoop = true;
let renderUntil = Infinity;            // the loop renders until then (heroGate)
requestAnimationFrame(function frame() {
  if (!ownLoop) return;
  const now = performance.now();
  if (now < renderUntil) ctx.engine?.tick(now);
  requestAnimationFrame(frame);
});

/**
 * Ruling R68: while this loop drives the engine, the canvas can only show the hero portrait, held still, which
 * would sit behind every later section's text. So the canvas shows only while the hero still reaches the foot of the
 * viewport (an IntersectionObserver on #top over the viewport's bottom 1%): once the next section scrolls in, it
 * fades out and the loop stops rendering when the fade ends; back in the hero, rendering resumes and it fades in.
 * Released (the canvas shown, the observer gone) once gsap's ticker takes over.
 */
function heroGate() {
  const scene = document.getElementById('scene');
  const hero = document.getElementById('top');
  if (!scene || !hero || typeof IntersectionObserver !== 'function') return () => {};
  const show = (on) => {
    renderUntil = on ? Infinity : performance.now() + HERO_FADE_MS;
    scene.style.transition = on
      ? `opacity ${HERO_FADE_MS}ms ease-out`
      : `opacity ${HERO_FADE_MS}ms ease-in, visibility 0s linear ${HERO_FADE_MS}ms`;
    scene.style.opacity = on ? '' : '0';
    scene.style.visibility = on ? '' : 'hidden';
  };
  const watch = new IntersectionObserver((entries) => show(entries[entries.length - 1].isIntersecting), {
    rootMargin: '-99% 0px 0px 0px',   // the viewport's bottom 1%: the hero still reaches its foot
  });
  watch.observe(hero);
  return () => {
    watch.disconnect();
    show(true);
    setTimeout(() => { scene.style.transition = ''; }, HERO_FADE_MS);
  };
}
const releaseHeroGate = heroGate();
// A cut jump lands with the canvas faded out: the engine rebinds there at once instead of dipping (no ghost).
ctx.scroll.on('jump', ({ mode }) => {
  if (mode === 'cut') ctx.engine?.cutTo();
});
let engineSettled = false;
loadEngine().then((engine) => {
  engineSettled = true;
  ctx.engine = engine;
  settleEngine(engine);
  if (!engine) ownLoop = false;        // nothing to render
  else if (noWebgl === 'late') leaveNoWebgl(engine);
});
veil.onLift(() => {
  if (!engineSettled) enterNoWebgl('late');   // the cap (or an asset error) lifted the veil first
});
// After the lift, by any route (the meter, the 8 s cap, an asset error), the other formations build in idle tasks.
veil.onLift(() => ctx.engineReady.then((engine) => engine?.buildDeferred()));

const fonts = fontsSettled();
let laidOut = fonts;          // with the libraries: settles once the word widths are locked (initReveals)
restorePlace();               // on the native layout: a CDN that never answers still leaves the page where it was
const libs = await loadScrollLibs();
if (libs) {
  const { gsap, ScrollTrigger, Lenis } = libs;
  // Arriving after the veil (the cap lifted it; Ruling R29), .js-scroll lengthens the stages under the reader: the
  // place is taken before and put back after, and again once the sections have set their lengths if the reader has
  // not scrolled meanwhile. A jump in flight measures its target after its fade-out (scroll.js).
  const here = window.__veil?.lifted ? ctx.scroll.anchor() : null;
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add('js-scroll');
  ctx.gsap = gsap;
  ctx.ScrollTrigger = ScrollTrigger;
  ctx.scroll.attach({ Lenis, gsap, ScrollTrigger });
  if (here) ctx.scroll.toAnchor(here);
  else restorePlace();
  const restoredAt = scrollY;
  reducedQuery.removeEventListener('change', followReduced);
  gsap.matchMedia().add(REDUCED, () => {
    applyReduced(true);
    return () => applyReduced(false);
  });
  ownLoop = false;
  releaseHeroGate();
  gsap.ticker.add((time, deltaTime) => {
    // A section's tick that throws is logged and dropped, so one bug cannot stop the render after it.
    for (let i = 0; i < tickers.length; i++) {
      try {
        tickers[i](time, deltaTime);
      } catch (err) {
        console.error('A tick callback failed and was removed.', err);
        tickers.splice(i--, 1);
      }
    }
    ctx.engine?.tick(performance.now());   // render last (spec §4.7: lenis.raf → section state → render)
  });
  createBoundaryTriggers(ScrollTrigger);
  // The sections after the hero: all six modules load at once, then init in page order; one that fails is logged
  // and the rest still initialise.
  await loadSections(SECTIONS, (name) => import(`./sections/${name}.js`), ctx, console.error);
  if (here && scrollY === restoredAt) ctx.scroll.toAnchor(here);
  try {
    laidOut = initReveals(ctx);   // settles after the word widths are locked
  } catch (err) {
    console.error(err);
  }
  laidOut.then(() => ScrollTrigger.refresh());
  // Fonts that arrive late (a stalled font sheet, past the cap) refit the hero name and re-wrap the copy (hero.js,
  // split.js), which moves every section below: the triggers re-measure once those relayouts have run.
  let fontTimer = 0;
  document.fonts?.addEventListener('loadingdone', () => {
    clearTimeout(fontTimer);
    fontTimer = setTimeout(() => ScrollTrigger.refresh(), FONT_REFRESH_MS);
  });
}

await fonts;
await heroReady;
await laidOut;
// Late font swaps, the locked word widths and the hero's portrait slot can all have moved the sections since the
// first restore: put the page back at the same place while the veil still hides it.
if (!window.__veil?.lifted) restorePlace();
if (simulate === 'hang') await new Promise(() => {});
await veil.liftWhenReady();
