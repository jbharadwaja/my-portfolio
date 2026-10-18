// The Route (spec §2.6, §4.4, §4.5): the night stage. Its sticky stage's progress p drives the timeline — the
// ground goes to night, the route traces AIT → Tokyo → Seoul → Tustin, the city cards swap in at each third, a
// hold for the reticle, then back to paper. uNight follows the timeline at no more than 2.5 units/s, so racing
// through only dims the page partially; the Route DOM shows only while uNight ≥ 0.9. Without the engine the stage
// still runs on a DOM night ground. routeTimeline is pure and Node-testable; init(ctx) touches the DOM and gets
// ScrollTrigger and the engine through ctx (this module imports no CDN library).
import { WORLDMAP, CITIES } from '../data/worldmap-dots.js';
import { cellToLonLat, formatLatLon } from '../engine/geo.js';
import { limitRate } from '../engine/resolver.js';
import { mulberry32 } from '../engine/formations/common.js';
import { MAP_BOX, buildWorldMap, routeAllocation, routeAlpha, routeLegs } from '../engine/formations/worldmap.js';
import { holdReveal } from '../ui/split.js';
import { veil } from '../ui/veil.js';

const K = 5;                           // the world map's formation index
const SEED = 0x5e01;
const NIGHT_IN = 0.08;                 // p 0–0.08: uNight 0 → 1
const ROUTE_END = 0.8;                 // p 0.08–0.80: uRoute 0 → 1
const HOLD_END = 0.92;                 // p 0.80–0.92: the reticle; p 0.92–1: uNight 1 → 0
const LEGS = 3;                        // AIT → Tokyo → Seoul → Tustin: card k shows from uRoute = k/3
const NIGHT_RATE = 2.5;                // uNight units/s at most (spec §4.5)
const DT_MAX = 1 / 30;                 // every integrator's clamped dt (spec §4.7)
const SHOW_FROM = 0.9;                 // the Route DOM fades in over uNight 0.9 → 1 and out again before 0.9
const BLEND_FLIP = 0.5;                // the blend, the chrome and the ground attribute flip here
const WIDE = '(min-width: 768px)';     // left panel at ≥ 768 px; below, a bottom sheet and the route box framed
const FINE = '(pointer: fine)';
const MAP_GAP = 12;                    // px between the route box's rect and the head or the sheet (< 768 px)
const READOUT_OFFSET = 18;             // px from the pointer to the readout chip
const RESIZE_DEBOUNCE_MS = 150;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * The Route's state at stage progress p (spec §2.6): night (the uNight target), route (uRoute), card (0–3, card k
 * from uRoute = k/3), reticle (the hold). Writes into `out` when given (no per-frame allocation).
 */
export function routeTimeline(p, out = {}) {
  out.night = p < NIGHT_IN ? clamp01(p / NIGHT_IN) : p > HOLD_END ? clamp01(1 - (p - HOLD_END) / (1 - HOLD_END)) : 1;
  out.route = clamp01((p - NIGHT_IN) / (ROUTE_END - NIGHT_IN));
  out.card = Math.min(LEGS, Math.floor(out.route * LEGS));
  out.reticle = p >= ROUTE_END && p <= HOLD_END;
  return out;
}

/** The route's bounding box on the map in world units, centre and size (≈ 50°W–92°E of centre, 14–53°N). */
function routeBox() {
  const legs = routeLegs(300);
  let u0 = 1;
  let u1 = 0;
  let v0 = 1;
  let v1 = 0;
  for (let i = 0; i < legs.length; i += 3) {
    u0 = Math.min(u0, legs[i]);
    u1 = Math.max(u1, legs[i]);
    v0 = Math.min(v0, legs[i + 1]);
    v1 = Math.max(v1, legs[i + 1]);
  }
  return { x: ((u0 + u1) / 2 - 0.5) * MAP_BOX.w, y: (0.5 - (v0 + v1) / 2) * MAP_BOX.h, w: (u1 - u0) * MAP_BOX.w, h: (v1 - v0) * MAP_BOX.h };
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
 * the reticle once the engine is there. Never waits for the engine (Ruling R55).
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
  section.classList.add('route-live');

  // The stage scrub: measures only (spec §5.1).
  let progress = 0;
  const write = (self) => { progress = self.progress; };
  ctx.ScrollTrigger.create({ trigger: section, start: 'top top', end: 'bottom bottom', onUpdate: write, onRefresh: write });

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
  let applied = NaN;                   // the uNight last applied to the ground, the chrome and the DOM
  let ink = -1;
  let card = -1;
  let reticleOn = false;

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
    if (night >= BLEND_FLIP) root.dataset.ground = 'night';
    else if (root.dataset.ground) delete root.dataset.ground;
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
    const dt = Math.min(deltaMs / 1000, DT_MAX);
    setNight(lifted ? limitRate(night, tl.night, NIGHT_RATE, dt) : tl.night);
    showCard(tl.card);
    reticleOn = Boolean(engine) && tl.reticle && fine.matches;
    if (!engine) return;
    engine.state.uniforms.uRoute = tl.route;
    engine.state.parallax = !reticleOn;   // the map must not slide under the crosshair (spec §2.6)
  });

  ctx.engineReady.then((ready) => {
    if (!ready) {
      section.classList.add('route-dom');   // no canvas: the stage carries its own night ground
      return;
    }
    engine = ready;
    applied = NaN;
    setNight(night);
    initMap(ctx, engine, { stage, head, deck });
    initReticle(engine, { stage, readout, isOn: () => reticleOn });
  }).catch((err) => console.error('Route map setup failed.', err));
}

/** Formation 5 and its pose: roll 0; the full stage at ≥ 768 px, the route box between head and sheet below. */
function initMap(ctx, engine, { stage, head, deck }) {
  const { N, name } = ctx.tier;
  engine.registerFormation(K, () => buildWorldMap(N, { tierName: name, rng: mulberry32(SEED) }));
  const { R, stackMax } = routeAllocation(N, name);
  const pu = engine.particles.uniforms;
  engine.state.uniforms.uMapStack = stackMax;
  engine.state.uniforms.uRouteAlpha = routeAlpha(R, pu.uSize.value * pu.uSizeScale.value);

  const wide = matchMedia(WIDE);
  const box = routeBox();
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  const pose = { roll: 0, rect: () => rect, lookAt: [0, 0, 0], box: null };
  const measure = () => {
    const s = stage.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = s.height || innerHeight;
    if (wide.matches) {
      Object.assign(rect, { x: 0, y: 0, w: vw, h: vh });
      pose.lookAt = [0, 0, 0];
      pose.box = null;
    } else {
      const top = head.getBoundingClientRect().bottom - s.top + MAP_GAP;
      const bottom = deck.getBoundingClientRect().top - s.top - MAP_GAP;
      Object.assign(rect, { x: 0, y: top, w: vw, h: Math.max(bottom - top, vh * 0.2) });
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
  const placed = { x: NaN, y: NaN };   // where the chip was last put
  let overPanel = false;
  let on = false;
  let text = '';
  let chipW = 0;
  let vw = document.documentElement.clientWidth;
  addEventListener('resize', () => { vw = document.documentElement.clientWidth; });
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
        placed.x = NaN;
      }
    }
    if (!text || (pointer.x === placed.x && pointer.y === placed.y)) return;
    placed.x = pointer.x;
    placed.y = pointer.y;
    // Right of and below the pointer, flipped to its left near the right edge (while pinned the stage is the viewport).
    const right = pointer.x + READOUT_OFFSET;
    const x = right + chipW > vw ? pointer.x - READOUT_OFFSET - chipW : right;
    readout.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(pointer.y + READOUT_OFFSET)}px, 0)`;
  });
}
