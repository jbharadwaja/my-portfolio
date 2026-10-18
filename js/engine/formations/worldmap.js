// Formation 5 — the world map (spec §4.2 row 5, §2.6). Pure. The baked lattice (js/data/worldmap-dots.js) is laid
// out in the formation's plane, one cell per CELL world units: column c, row r sits at u = (c + 0.5)/cols,
// v = (r + 0.5)/rows, x = (u − 0.5)·w, y = (0.5 − v)·h — the mapping the shader's reticle inverts (shaders.js).
// Land dots (meta 0) are stacked up to three deep where the tier has particles to spare; the route (meta 1 + t)
// follows three great-circle legs between the CITIES, each leg one third of t; the rest is ocean dust.
import { WORLDMAP, CITIES } from '../../data/worldmap-dots.js';
import { decodeRuns, wrap180 } from '../geo.js';
import { makeFormation, shuffle } from './common.js';

const DEG = Math.PI / 180;
const CELL = 0.04;                     // world units per lattice cell
const ROUTE_MAX = 1500;
const ROUTE_SHARE = 0.12;              // R = min(1,500, round(0.12·N))
const DUST_MIN = 300;                  // minN = land dots + R + 300 (spec §4.2)
const STACK_MAX = 3;                   // one dot plus up to two stacked on it (desktop and laptop only)
const STACK_TIERS = new Set(['desktop', 'laptop']);
const STACK_JITTER = 0.18;             // ± of a cell: a stacked dot stays inside its cell (the reticle's test)
const STACK_DEPTH = 0.05;              // ± of a cell in z
const DUST_DEPTH = 0.15;               // ± world units in z around the plane
const LENGTH_SAMPLES = 257;            // points per leg when measuring its length on the map
const ROUTE_COVER = 1.4;               // summed alpha of the points covering one spot of the line (their soft
                                       // edges and size spread leave the line's centre at about full orange)

const LAND = decodeRuns(WORLDMAP);     // interleaved (col, row) of the 7,720 land dots
const LAND_DOTS = LAND.length / 2;
const IS_LAND = new Uint8Array(WORLDMAP.cols * WORLDMAP.rows);
for (let d = 0; d < LAND.length; d += 2) IS_LAND[LAND[d + 1] * WORLDMAP.cols + LAND[d]] = 1;

/** The map's extent in world units (the formation's box). */
export const MAP_BOX = Object.freeze({ w: WORLDMAP.cols * CELL, h: WORLDMAP.rows * CELL });

/**
 * How N particles are shared out: R route particles, `stackMax` particles per land dot (3 on desktop and laptop,
 * fewer only if N cannot carry three; 1 on mobile and saver), and the rest ocean dust.
 */
export function routeAllocation(N, tierName) {
  const R = Math.min(ROUTE_MAX, Math.round(ROUTE_SHARE * N));
  const room = Math.floor((N - R - DUST_MIN) / LAND_DOTS);
  const stackMax = STACK_TIERS.has(tierName) ? Math.max(1, Math.min(STACK_MAX, room)) : 1;
  return { R, stackMax, dust: N - R - LAND_DOTS * stackMax };
}

const toUnit = ({ lat, lon }) => {
  const c = Math.cos(lat * DEG);
  return [c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG)];
};

/** n points along the great circle from a to b (slerp; both ends included), evenly spaced by distance. */
export function greatCircle(a, b, n) {
  const p = toUnit(a);
  const q = toUnit(b);
  const omega = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  const s = Math.sin(omega);
  const out = new Array(n);
  for (let j = 0; j < n; j++) {
    const f = n > 1 ? j / (n - 1) : 0;
    const wa = s > 1e-9 ? Math.sin((1 - f) * omega) / s : 1 - f;
    const wb = s > 1e-9 ? Math.sin(f * omega) / s : f;
    const x = wa * p[0] + wb * q[0];
    const y = wa * p[1] + wb * q[1];
    const z = wa * p[2] + wb * q[2];
    out[j] = { lat: Math.atan2(z, Math.hypot(x, y)) / DEG, lon: Math.atan2(y, x) / DEG };
  }
  return out;
}

const toU = (lon) => (wrap180(lon - WORLDMAP.lon0) + 180) / 360;
const toV = (lat) => (WORLDMAP.latN - lat) / (WORLDMAP.latN - WORLDMAP.latS);
const LEGS = CITIES.length - 1;

/** A leg's length as drawn on the map, in world units (its great circle sampled finely). */
function mapLength(a, b) {
  const pts = greatCircle(a, b, LENGTH_SAMPLES);
  let length = 0;
  for (let j = 1; j < pts.length; j++) {
    length += Math.hypot((toU(pts[j].lon) - toU(pts[j - 1].lon)) * MAP_BOX.w, (toV(pts[j].lat) - toV(pts[j - 1].lat)) * MAP_BOX.h);
  }
  return length;
}
const LEG_LENGTHS = Array.from({ length: LEGS }, (_, k) => mapLength(CITIES[k], CITIES[k + 1]));
const ROUTE_LENGTH = LEG_LENGTHS.reduce((sum, l) => sum + l, 0);

/**
 * The route as R × (u, v, t): u, v the map coordinates of each particle (v grows downward), t its place along the
 * route. Each leg (AIT → Tokyo → Seoul → Tustin) takes an equal third of t — t = (leg + distance fraction within
 * the leg)/3, 0 at AIT to 1 at Tustin — so the short Tokyo → Seoul hop gets as much scroll as the Pacific. The
 * particles are shared by each leg's length on the map, so the drawn line is equally dense on every leg (the
 * additive glow then reads orange everywhere instead of saturating on the short hops).
 */
export function routeLegs(R) {
  const out = new Float32Array(R * 3);
  let i = 0;
  let along = 0;
  for (let leg = 0; leg < LEGS; leg++) {
    const start = Math.round((along / ROUTE_LENGTH) * R);
    along += LEG_LENGTHS[leg];
    const n = Math.round((along / ROUTE_LENGTH) * R) - start;
    const pts = greatCircle(CITIES[leg], CITIES[leg + 1], n);
    for (let j = 0; j < n; j++, i++) {
      out[i * 3] = toU(pts[j].lon);
      out[i * 3 + 1] = toV(pts[j].lat);
      out[i * 3 + 2] = (leg + (n > 1 ? j / (n - 1) : 0)) / LEGS;
    }
  }
  return out;
}

/**
 * Alpha for each of R route particles of world-space `diameter` (uSize · uSizeScale): the points overlapping on the
 * line add up to ROUTE_COVER whatever the tier, so the additive glow reads orange instead of saturating to yellow
 * (only the hot head does). At most 1.
 */
export function routeAlpha(R, diameter) {
  return Math.min(1, (ROUTE_COVER * ROUTE_LENGTH) / (R * diameter));
}

/** Formation 5 for N particles on tier `tierName`. Land meta 0, route meta 1 + t (1..2), ocean dust −1. */
export function buildWorldMap(N, { tierName, rng }) {
  const { cols, rows } = WORLDMAP;
  const { w, h } = MAP_BOX;
  const { R, stackMax, dust } = routeAllocation(N, tierName);
  const minN = LAND_DOTS + R + DUST_MIN;
  if (N < minN) throw new RangeError(`The world map needs ${minN} particles, got ${N}.`);
  const data = makeFormation(N);
  const put = (i, x, y, z, meta) => {
    data[i * 4] = x;
    data[i * 4 + 1] = y;
    data[i * 4 + 2] = z;
    data[i * 4 + 3] = meta;
  };
  const jitter = (amount) => (2 * rng() - 1) * amount * CELL;
  let i = 0;

  // Land: every dot once, then the stacked copies with a small jitter (the shader gives each 0.9/stack of the alpha).
  for (let s = 0; s < stackMax; s++) {
    for (let d = 0; d < LAND.length; d += 2, i++) {
      const col = LAND[d];
      const row = LAND[d + 1];
      const x = ((col + 0.5) / cols - 0.5) * w;
      const y = (0.5 - (row + 0.5) / rows) * h;
      if (s === 0) put(i, x, y, 0, 0);
      else put(i, x + jitter(STACK_JITTER), y + jitter(STACK_JITTER), jitter(STACK_DEPTH), 0);
    }
  }

  const route = routeLegs(R);
  for (let r = 0; r < R; r++, i++) {
    put(i, (route[r * 3] - 0.5) * w, (0.5 - route[r * 3 + 1]) * h, 0, 1 + route[r * 3 + 2]);
  }

  // Ocean dust: uniform over the cells without land, anywhere inside its cell.
  for (let k = 0; k < dust; k++, i++) {
    let cell;
    do cell = Math.floor(rng() * cols * rows); while (IS_LAND[cell]);
    const u = ((cell % cols) + rng()) / cols;
    const v = (Math.floor(cell / cols) + rng()) / rows;
    put(i, (u - 0.5) * w, (0.5 - v) * h, (2 * rng() - 1) * DUST_DEPTH, -1);
  }

  shuffle(data, 4, rng);               // so any slice of the particles is spread over the whole map
  return { data, box: { w, h }, minN };
}
