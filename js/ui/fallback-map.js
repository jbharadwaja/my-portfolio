// The Route's 2D map for the no-WebGL page (spec §8.3), and the route geometry the live stage frames with too
// (routeBox, narrowRegion; js/sections/route.js). main.js mounts the map through ctx.fallback and imports this
// module only then, so the Route's own module failing (or this one) never takes main.js down with it.
// mapFit is pure and Node-testable; nothing here touches the DOM until it is called.
import { WORLDMAP, CITIES } from '../data/worldmap-dots.js';
import { decodeRuns } from '../engine/geo.js';
import { MAP_BOX, routeLegs } from '../engine/formations/worldmap.js';
import { FRAME_SLACK } from '../engine/framing.js';

/**
 * Where the map is framed on the whole stage: from 768 px wide, and on a stage under 560 px tall (a phone on its side),
 * where css/sections/route.css puts the cards in a bottom sheet right under the head and leaves no room between the two
 * for the route box. Elsewhere (below 768 px on a taller stage) the route box is framed between the head and the sheet.
 */
export const FULL_STAGE = '(min-width: 768px), (max-height: 559.98px)';
const MAP_GAP = 12;                    // px between the route box's rect and the head or the sheet (narrowRegion)

/**
 * The 2D fallback map's placement (spec §8.3): the lattice's `focus` box (in cells; the whole lattice by default)
 * fitted inside `region` (CSS px) and centred. Lattice cell (c, r) spans x + c·cell … x + (c + 1)·cell.
 */
export function mapFit(region, focus = { x: 0, y: 0, w: WORLDMAP.cols, h: WORLDMAP.rows }) {
  const cell = Math.min(region.w / focus.w, region.h / focus.h);
  return {
    x: region.x + (region.w - focus.w * cell) / 2 - focus.x * cell,
    y: region.y + (region.h - focus.h * cell) / 2 - focus.y * cell,
    cell,
  };
}

/** The route's bounding box on the map in world units, centre and size (≈ 50°W–92°E of centre, 14–53°N). */
export function routeBox() {
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

/** The route's bounding box in lattice cells, grown by the engine's framing slack about its centre. */
function routeFocus() {
  const box = routeBox();
  const cx = (box.x / MAP_BOX.w + 0.5) * WORLDMAP.cols;
  const cy = (0.5 - box.y / MAP_BOX.h) * WORLDMAP.rows;
  const w = (box.w / MAP_BOX.w) * WORLDMAP.cols * FRAME_SLACK;
  const h = (box.h / MAP_BOX.h) * WORLDMAP.rows * FRAME_SLACK;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Outside FULL_STAGE the map frames the route between the head and the card sheet, in the stage's CSS px. */
export function narrowRegion(stage, head, deck) {
  const s = stage.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = s.height || innerHeight;
  const top = head.getBoundingClientRect().bottom - s.top + MAP_GAP;
  const bottom = deck.getBoundingClientRect().top - s.top - MAP_GAP;
  return { x: 0, y: top, w: vw, h: Math.max(bottom - top, vh * 0.2) };
}

let landDots = null;                   // interleaved (col, row) of the land dots, decoded on first draw

/**
 * Draws the no-WebGL map (spec §8.3) on a 2D canvas, sized to its CSS box: the land dots in mist and the whole
 * route in orange with its four stops, the lattice (or its `focus`, in cells) fitted into `region` (CSS px; the
 * whole canvas by default).
 */
export function drawFallbackMap(canvas, { region = null, focus } = {}) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!(w > 0 && h > 0)) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { x, y, cell } = mapFit(region ?? { x: 0, y: 0, w, h }, focus);
  const style = getComputedStyle(canvas);
  const mist = style.getPropertyValue('--c-mist').trim() || '#E9E9E4';
  const signal = style.getPropertyValue('--c-signal').trim() || '#FF4D00';
  const at = (u, v) => [x + u * WORLDMAP.cols * cell, y + v * WORLDMAP.rows * cell];

  landDots ??= decodeRuns(WORLDMAP);
  const r = Math.max(0.5, cell * 0.3);
  g.beginPath();
  for (let i = 0; i < landDots.length; i += 2) {
    const cx = x + (landDots[i] + 0.5) * cell;
    const cy = y + (landDots[i + 1] + 0.5) * cell;
    g.moveTo(cx + r, cy);
    g.arc(cx, cy, r, 0, 2 * Math.PI);
  }
  g.globalAlpha = 0.4;
  g.fillStyle = mist;
  g.fill();

  const legs = routeLegs(600);
  g.beginPath();
  for (let i = 0; i < legs.length; i += 3) {
    const [px, py] = at(legs[i], legs[i + 1]);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.globalAlpha = 1;
  g.strokeStyle = signal;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
  g.beginPath();
  for (const { col, row } of CITIES) {
    const cx = x + (col + 0.5) * cell;
    const cy = y + (row + 0.5) * cell;
    g.moveTo(cx + 3.5, cy);
    g.arc(cx, cy, 3.5, 0, 2 * Math.PI);
  }
  g.fillStyle = signal;
  g.fill();
}

/**
 * Mounts the no-WebGL map on the Route's stage (behind its panels) and keeps it drawn to the stage's size.
 * Returns its unmount, or null without a stage.
 */
export function mountFallbackMap(section) {
  const stage = section?.querySelector('.stage');
  if (!stage) return null;
  const head = stage.querySelector('.route-head');
  const deck = stage.querySelector('.route-cards');
  const canvas = document.createElement('canvas');
  canvas.className = 'route-map';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const full = matchMedia(FULL_STAGE);
  const draw = () => {
    // Outside FULL_STAGE the live stage frames the route between the head and the sheet, as the engine does (route.js).
    const narrow = !full.matches && section.classList.contains('route-live') && head && deck;
    drawFallbackMap(canvas, narrow ? { region: narrowRegion(stage, head, deck), focus: routeFocus() } : {});
  };
  const observer = new ResizeObserver(draw);
  for (const el of [canvas, head, deck]) if (el) observer.observe(el);
  return () => {
    observer.disconnect();
    canvas.remove();
  };
}
