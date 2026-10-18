// The Route (spec §2.6, §4.4, §4.5): the night stage. Its sticky stage's progress p drives the timeline — the
// route traces AIT → Tokyo → Seoul → Tustin, the city cards swap in at each third, a hold for the reticle. The night
// itself is time-driven at thresholds (Ruling R75): past p 0.02 uNight fades to 1 over 450 ms, past p 0.94 back to 0,
// with hysteresis on the way back, so no pause is ever half grey (300 ms fades under reduced motion; a cut jump
// snaps it under its fade). The night chrome flips with hysteresis, and the Route DOM shows only while uNight ≥ 0.9.
// A jump to the Route (nav, console, #route) lands at p 0.10: on night, the heading and the first card showing.
// Until the engine is there (and without it, or once its context is lost for good) the stage runs on a DOM night
// ground; without WebGL the map is drawn on a 2D canvas (js/ui/fallback-map.js, spec §8.3).
// routeTimeline, nightOn, nightStep, groundState and readoutAt are pure and Node-testable; init(ctx) touches the DOM
// and gets ScrollTrigger, the scroll and the engine through ctx (this module imports no CDN library).
import { WORLDMAP, CITIES } from '../data/worldmap-dots.js';
import { cellToLonLat, formatLatLon } from '../engine/geo.js';
import { limitRate } from '../engine/resolver.js';
import { mulberry32 } from '../engine/formations/common.js';
import { MAP_BOX, buildWorldMap, routeAllocation, routeAlpha } from '../engine/formations/worldmap.js';
import { routeBox, narrowRegion, FULL_STAGE } from '../ui/fallback-map.js';
import { holdReveal } from '../ui/split.js';
import { veil } from '../ui/veil.js';

const K = 5;                           // the world map's formation index
const SEED = 0x5e01;
const ROUTE_START = 0.08;              // p 0.08–0.80: uRoute 0 → 1
const ROUTE_END = 0.8;
const HOLD_END = 0.92;                 // p 0.80–0.92: the reticle
const NIGHT_ON = 0.02;                 // the night fades in once p ≥ 0.02 …
const NIGHT_OFF = 0.94;                // … and out again once p ≥ 0.94 (Ruling R75)
const NIGHT_BAND = 0.01;               // hysteresis: on the way back it returns below 0.93 and goes below 0.01
const NIGHT_FADE_S = 0.45;             // each fade, in seconds …
const REDUCED_NIGHT_S = 0.3;           // … and under reduced motion (spec §3.3)
/** Where a jump to the Route lands (nav, console, #route): night, the heading and the first card showing (R75). */
export const LANDING_P = 0.1;
const LEGS = 3;                        // AIT → Tokyo → Seoul → Tustin: card k shows from uRoute = k/3
const DT_MAX = 1 / 30;                 // every integrator's clamped dt (spec §4.7)
const SHOW_FROM = 0.9;                 // the Route DOM fades in over uNight 0.9 → 1 and out again before 0.9
const GROUND = { on: 0.7, off: 0.3 };  // <html data-ground="night"> from uNight ≥ 0.7 until ≤ 0.3 (Ruling R59)
const WIDE = '(min-width: 768px)';     // left panel at ≥ 768 px; below, a bottom sheet (the map: FULL_STAGE)
const FINE = '(pointer: fine)';
const READOUT_OFFSET = 18;             // px from the pointer to the readout chip
const RESIZE_DEBOUNCE_MS = 150;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * The Route's state at stage progress p (spec §2.6): route (uRoute), card (0–3, card k from uRoute = k/3), reticle
 * (the hold). Writes into `out` when given (no per-frame allocation). The night is not scrubbed: nightOn.
 */
export function routeTimeline(p, out = {}) {
  out.route = clamp01((p - ROUTE_START) / (ROUTE_END - ROUTE_START));
  out.card = Math.min(LEGS, Math.floor(out.route * LEGS));
  out.reticle = p >= ROUTE_END && p <= HOLD_END;
  return out;
}

/**
 * Whether the night is on at stage progress p, given `prev` (Ruling R75): on from p 0.02 until p 0.94. On the way
 * back the same thresholds apply a band further back — on again below 0.93, off below 0.01 — so a scroll resting on
 * a threshold never flickers between the two.
 */
export function nightOn(prev, p) {
  return prev ? p >= NIGHT_ON - NIGHT_BAND && p < NIGHT_OFF : p >= NIGHT_ON && p < NIGHT_OFF - NIGHT_BAND;
}

/** uNight after `dt` seconds from `night`, fading toward 1 while `on` (else 0): 450 ms a fade, 300 ms reduced. */
export function nightStep(night, on, reduced, dt) {
  return limitRate(night, on ? 1 : 0, 1 / (reduced ? REDUCED_NIGHT_S : NIGHT_FADE_S), dt);
}

/**
 * Whether the night chrome is on (`<html data-ground="night">`, spec §2.1) at uNight `night`, given `prev`: on from
 * 0.7, off from 0.3, held in between, so a fast flick through the Route (uNight peaks near 0.66) never flips it.
 * The engine still flips its blend at 0.5 (engine.ground), under the particle dip.
 */
export function groundState(prev, night) {
  if (night >= GROUND.on) return true;
  if (night <= GROUND.off) return false;
  return prev;
}

/**
 * Where the reticle readout chip goes, as { x, y } in the stage's CSS px, for a pointer at (px, py): right of and
 * below it, flipped to its left near the right edge and above it near the bottom (a vw × vh stage, a w × h chip).
 */
export function readoutAt(px, py, w, h, vw, vh, out = { x: 0, y: 0 }) {
  const right = px + READOUT_OFFSET;
  const below = py + READOUT_OFFSET;
  out.x = right + w > vw ? px - READOUT_OFFSET - w : right;
  out.y = below + h > vh ? py - READOUT_OFFSET - h : below;
  return out;
}

/** The readout for lattice cell (col, row): a city's exact coordinates on its dot, otherwise the cell centre. */
function readoutFor(col, row) {
  const city = CITIES.find((c) => c.col === col && c.row === row);
  if (city) return formatLatLon(city.lat, city.lon);
  const { lat, lon } = cellToLonLat(col, row, WORLDMAP);
  return formatLatLon(lat, lon);
}

/**
 * Wires the Route stage: its scrub, the night ground and chrome, the city cards and the held reveals; the map and
 * the reticle once the engine is there. Never waits for the engine (Ruling R55): the stage starts on its DOM night
 * ground (.route-dom), which gives way to the canvas's once the engine resolves.
 */
export async function init(ctx) {
  const root = document.documentElement;
  const section = document.getElementById('route');
  const stage = section?.querySelector('.stage');
  const head = stage?.querySelector('.route-head');
  const deck = stage?.querySelector('.route-cards');
  const readout = stage?.querySelector('.reticle-readout');
  if (!section || !stage || !head || !deck || !readout || !ctx.ScrollTrigger) return;
  const cards = [...deck.querySelectorAll('.route-card[data-stop]')].sort((a, b) => a.dataset.stop - b.dataset.stop);
  const fine = matchMedia(FINE);
  section.classList.add('route-live', 'route-dom');

  // Below 768 px the cards are a bottom sheet (css/sections/route.css). While a card is taller than the sheet, the
  // sheet scrolls on its own: Lenis leaves its wheel alone and its overscroll is contained (both keyed on
  // data-lenis-prevent). Otherwise a wheel or a swipe on it scrolls the page.
  const wide = matchMedia(WIDE);
  new ResizeObserver(() => {
    deck.toggleAttribute('data-lenis-prevent', !wide.matches && deck.scrollHeight > deck.clientHeight);
  }).observe(deck);

  // The stage scrub: measures only (spec §5.1). A jump to the Route lands at LANDING_P of it (Ruling R75).
  let progress = 0;
  const write = (self) => { progress = self.progress; };
  const st = ctx.ScrollTrigger.create({ trigger: section, start: 'top top', end: 'bottom bottom', onUpdate: write, onRefresh: write });
  ctx.scroll.setLanding(section.id, () => (st.end > st.start ? st.start + LANDING_P * (st.end - st.start) : NaN));

  // The h2 and subtitle reveals would play unseen as the stage scrolls in (the Route DOM is hidden until
  // uNight ≥ 0.9), so they wait for the DOM to show (Ruling R33).
  let shown = false;
  const waiting = [];
  const whenShown = (play) => {
    if (shown) play();
    else waiting.push(play);
  };
  head.querySelectorAll('h2, .section-sub').forEach((el) => holdReveal(el, whenShown));

  // Before the veil lifts uNight jumps to its target, so a reload or a #route visit opens on the right ground.
  let lifted = false;
  veil.onLift(() => { lifted = true; });

  const tl = routeTimeline(0);
  let engine = null;
  let night = 0;
  let on = false;                      // the night's target (nightOn, with its hysteresis)
  let applied = NaN;                   // the uNight last applied to the ground, the chrome and the DOM
  let nightChrome = false;             // <html data-ground="night"> (groundState)
  let ink = -1;
  let card = -1;
  let reticleOn = false;
  let parallax = true;                 // engine.state.parallax as last written (the engine starts with it on)

  function showCard(k) {
    if (k === card) return;
    cards[card]?.classList.remove('is-current');
    cards[k]?.classList.add('is-current');
    card = k;
  }

  function setNight(n) {
    night = n;
    if (n === applied) return;
    applied = n;
    if (engine) engine.ground(night);   // clear colour, mist, and the blend flip at 0.5 (engine.particles.setBlending)
    else section.style.setProperty('--route-night', night.toFixed(3));
    const chrome = groundState(nightChrome, night);
    if (chrome !== nightChrome) {
      nightChrome = chrome;
      if (chrome) root.dataset.ground = 'night';
      else delete root.dataset.ground;
    }
    const nextInk = clamp01((night - SHOW_FROM) / (1 - SHOW_FROM));
    if (nextInk !== ink) {
      // Rising, the blocks ease in (css/sections/route.css); falling, they follow uNight exactly, so they are gone
      // before it drops below 0.9.
      section.classList.toggle('route-ink-rising', nextInk > ink);
      ink = nextInk;
      section.style.setProperty('--route-ink', ink.toFixed(3));
    }
    shown = night >= SHOW_FROM;
    if (shown) for (const play of waiting.splice(0)) play();
  }

  ctx.onTick((time, deltaMs) => {
    routeTimeline(progress, tl);
    on = nightOn(on, progress);
    const dt = Math.min(deltaMs / 1000, DT_MAX);
    setNight(lifted ? nightStep(night, on, ctx.reduced, dt) : on ? 1 : 0);
    showCard(tl.card);
    reticleOn = Boolean(engine) && tl.reticle && fine.matches;
    if (!engine) return;
    engine.state.uniforms.uRoute = tl.route;
    // The map must not slide under the crosshair (spec §2.6). Written only on a change, so the flag stays free for
    // any other section to use.
    const follow = !reticleOn;
    if (follow !== parallax) {
      parallax = follow;
      engine.state.parallax = follow;
    }
  });

  // A cut jump (scroll.js) has the page faded out once it lands: uNight goes straight to the destination's value
  // there, so the page never fades back in on a night that then slowly clears.
  ctx.scroll.on('jump', ({ mode }) => {
    if (mode !== 'cut') return;
    on = nightOn(on, progress);
    setNight(on ? 1 : 0);
  });

  ctx.engineReady.then((ready) => {
    if (!ready) return;                // no canvas: the stage keeps its own night ground (.route-dom)
    engine = ready;
    section.classList.remove('route-dom');
    applied = NaN;
    setNight(night);
    initMap(ctx, engine, { stage, head, deck });
    initReticle(engine, { stage, readout, isOn: () => reticleOn });
    // A context lost for good: back to the DOM night ground, no reticle (main.js mounts the 2D map).
    engine.on('contextfail', () => {
      engine = null;
      reticleOn = false;
      stage.classList.remove('reticle-on');
      readout.textContent = '';
      section.classList.add('route-dom');
      applied = NaN;
      setNight(night);
    });
  }).catch((err) => console.error('Route map setup failed.', err));
}

/** Formation 5 and its pose: roll 0; the whole stage within FULL_STAGE, else the route box between head and sheet. */
function initMap(ctx, engine, { stage, head, deck }) {
  const { N, name } = ctx.tier;
  engine.registerFormation(K, () => buildWorldMap(N, { tierName: name, rng: mulberry32(SEED) }));
  const { R, stackMax } = routeAllocation(N, name);
  const pu = engine.particles.uniforms;
  engine.state.uniforms.uMapStack = stackMax;
  engine.state.uniforms.uRouteAlpha = routeAlpha(R, pu.uSize.value * pu.uSizeScale.value);

  const full = matchMedia(FULL_STAGE);
  const box = routeBox();
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  const pose = { roll: 0, rect: () => rect, lookAt: [0, 0, 0], box: null };
  const measure = () => {
    if (full.matches) {
      const vh = stage.getBoundingClientRect().height || innerHeight;
      Object.assign(rect, { x: 0, y: 0, w: document.documentElement.clientWidth, h: vh });
      pose.lookAt = [0, 0, 0];
      pose.box = null;
    } else {
      Object.assign(rect, narrowRegion(stage, head, deck));
      pose.lookAt = [box.x, box.y, 0];
      pose.box = { w: box.w, h: box.h };
    }
    engine.setPose(K, pose);   // re-runs the map's density estimate at the new framing
  };
  measure();
  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(measure, RESIZE_DEBOUNCE_MS);
  };
  addEventListener('resize', later);
  document.fonts?.addEventListener('loadingdone', later);
  document.fonts?.ready.then(measure);
}

/**
 * The reticle (spec §2.6), on rendered frames while it is on: the pointer is unprojected onto the map plane, the
 * lattice cell under it goes to uReticle (the shader squares that row and column) and the readout chip follows the
 * pointer. Off the map, over the Route's panels or with the reticle off: uReticle is (−1, −1), the chip empty.
 */
function initReticle(engine, { stage, readout, isOn }) {
  const reticle = [-1, -1];
  engine.state.uniforms.uReticle = reticle;
  const hit = { x: 0, y: 0 };
  const placed = { x: NaN, y: NaN };   // the pointer where the chip was last put
  const at = { x: 0, y: 0 };
  let overPanel = false;
  let on = false;
  let text = '';
  let chipW = 0;
  let chipH = 0;
  // While pinned the stage is the viewport: its width, and its height (100svh) for the chip's flip above the pointer.
  let vw = document.documentElement.clientWidth;
  let vh = stage.clientHeight || innerHeight;
  addEventListener('resize', () => {
    vw = document.documentElement.clientWidth;
    vh = stage.clientHeight || innerHeight;
  });
  addEventListener('pointermove', (e) => {
    overPanel = Boolean(e.target.closest?.('.route-head, .route-card.is-current'));
  }, { passive: true });

  engine.onFrame(() => {
    const { pointer } = engine.state;
    let col = -1;
    let row = -1;
    if (isOn() && pointer.inside && !overPanel && engine.particles.has(K)) {
      engine.unproject(K, pointer.x, pointer.y, hit);
      const u = hit.x / MAP_BOX.w + 0.5;
      const v = 0.5 - hit.y / MAP_BOX.h;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        col = Math.floor(u * WORLDMAP.cols);
        row = Math.floor(v * WORLDMAP.rows);
      }
    }
    if (isOn() !== on) {
      on = !on;
      stage.classList.toggle('reticle-on', on);
    }
    if (col !== reticle[0] || row !== reticle[1]) {
      reticle[0] = col;
      reticle[1] = row;
      const next = col < 0 ? '' : readoutFor(col, row);
      if (next !== text) {
        readout.textContent = text = next;
        chipW = text ? readout.offsetWidth : 0;
        chipH = text ? readout.offsetHeight : 0;
        placed.x = NaN;
      }
    }
    if (!text || (pointer.x === placed.x && pointer.y === placed.y)) return;
    placed.x = pointer.x;
    placed.y = pointer.y;
    readoutAt(pointer.x, pointer.y, chipW, chipH, vw, vh, at);
    readout.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0)`;
  });
}
