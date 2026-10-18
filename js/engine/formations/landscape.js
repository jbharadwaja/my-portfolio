// Formation 3 — the loss landscape of the training run (spec §2.4, §4.2 row 3). Pure and Node-testable.
// f(x, y) is a bowl with two gaussian wells and gentle ripples on x, y ∈ [−3, 3]. A fixed-step gradient descent
// from START is the training run: epoch e puts the ball at P(e) and the HUD's losses are f(P(e)) rescaled.
// The formation is the surface seen from above at an angle: a regular grid, extra particles on six contour bands
// (so the surface reads as contour lines), and faint dust.
import { makeFormation, fillDust, shuffle } from './common.js';

const EXTENT = 3;                      // x, y ∈ [−EXTENT, EXTENT]
const GRID_CELLS = 200;                // the grid gridMin() searches: 200 × 200 samples, edges included
const GRAD_H = 1e-4;                   // central-difference step of the numeric gradient
export const EPOCHS = 100;
// Committed start and step (spec §2.4): from high on the far rim the run crosses between the two wells and settles
// into the deeper one in its last epochs, still a hair above the grid minimum at epoch 100.
export const START = [-1.9, 2.9];
export const STEP = 0.085;

const LOSS = { start: 1.2, min: 0.18 };   // f(P[0]) → 1.200, gridMin() → 0.180
const VAL = { base: 1.04, gain: 0.08 };   // val(e) = train(e) · (1.04 + 0.08 · e/100)
const LR = '3e-3';
const BEATS = 4;

// Builder shares (spec §4.2): 60% a regular grid, 25% on the contour bands, the rest (15%) dust.
const SHARE = { grid: 0.6, contour: 0.25 };
const CONTOUR = { levels: 6, halfWidth: 0.08 };   // |fract(6·f̂) − 0.5| < 0.08
const CONTOUR_TRIES = 400;             // rejection-sampling attempts per contour particle before giving up on a band
const DUST_RADIUS = 0.5;               // × the box width
const SAMPLE_GRID = 25;                // surfaceSamples(): 25 × 25, a sample every 0.25 units

// The view (local frame; the camera looks down −z): the surface is turned about its vertical axis, so the two
// wells sit side by side and the run comes down the middle toward the viewer, then tilted back by ELEVATION.
const YAW = (-30 * Math.PI) / 180;
const ELEVATION = (32 * Math.PI) / 180;
const HEIGHT = 0.6;                    // world units of rise per unit of f

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** The landscape: a bowl, a deep well near (1.1, 0.6), a shallower one near (−1.3, −0.9) and gentle ripples. */
export function landscapeF(x, y) {
  return 0.12 * (x * x + y * y)
    - 1.1 * Math.exp(-((x - 1.1) ** 2 + (y - 0.6) ** 2) / 0.5)
    - 0.7 * Math.exp(-((x + 1.3) ** 2 + (y + 0.9) ** 2) / 0.7)
    + 0.05 * Math.sin(3 * x) * Math.cos(3 * y);
}

let range = null;
/** { min, max } of f over the 200 × 200 grid on [−3, 3]² (computed once). */
function gridRange() {
  if (range) return range;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < GRID_CELLS; i++) {
    const x = -EXTENT + (2 * EXTENT * i) / (GRID_CELLS - 1);
    for (let j = 0; j < GRID_CELLS; j++) {
      const v = landscapeF(x, -EXTENT + (2 * EXTENT * j) / (GRID_CELLS - 1));
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  range = { min, max };
  return range;
}

/** The minimum of f over the 200 × 200 grid. */
export function gridMin() {
  return gridRange().min;
}

/** f normalised to 0..1 by the grid's range (the formation's meta, and what the contour bands are cut from). */
function normalised(f) {
  const { min, max } = gridRange();
  return clamp((f - min) / (max - min), 0, 1);
}

let path = null;
/** P[0..100]: [x, y, f(x, y)] by fixed-step gradient descent from START (numeric gradient, h = 1e-4). Computed once. */
export function descentPath() {
  if (path) return path;
  let [x, y] = START;
  path = [[x, y, landscapeF(x, y)]];
  for (let k = 0; k < EPOCHS; k++) {
    const gx = (landscapeF(x + GRAD_H, y) - landscapeF(x - GRAD_H, y)) / (2 * GRAD_H);
    const gy = (landscapeF(x, y + GRAD_H) - landscapeF(x, y - GRAD_H)) / (2 * GRAD_H);
    x -= STEP * gx;
    y -= STEP * gy;
    path.push([x, y, landscapeF(x, y)]);
  }
  return path;
}

/** P(e) for a fractional epoch: the lerp between P[⌊e⌋] and P[⌈e⌉], e clamped to 0..100. Writes into `out`. */
export function pathAt(e, out = [0, 0, 0]) {
  const P = descentPath();
  const t = clamp(e, 0, EPOCHS);
  const k = Math.min(EPOCHS - 1, Math.floor(t));
  const s = t - k;
  for (let i = 0; i < 3; i++) out[i] = P[k][i] + (P[k + 1][i] - P[k][i]) * s;
  return out;
}

const at = [0, 0, 0];
/** The HUD's losses at epoch e: train = f(P(e)) rescaled so f(P[0]) → 1.200 and gridMin() → 0.180; val per spec §2.4. */
export function epochValues(e) {
  const t = clamp(e, 0, EPOCHS);
  pathAt(t, at);
  const f0 = descentPath()[0][2];
  const min = gridMin();
  const train = LOSS.min + ((landscapeF(at[0], at[1]) - min) * (LOSS.start - LOSS.min)) / (f0 - min);
  return { train, val: train * (VAL.base + (VAL.gain * t) / EPOCHS) };
}

/** `epoch 042 / 100 · train 0.512 · val 0.538 · lr 3e-3` — ⌊e⌋ zero-padded to three digits, losses to three decimals. */
export function formatHud(e) {
  const t = clamp(e, 0, EPOCHS);
  const { train, val } = epochValues(t);
  return `epoch ${String(Math.floor(t)).padStart(3, '0')} / ${EPOCHS} · train ${train.toFixed(3)} · val ${val.toFixed(3)} · lr ${LR}`;
}

/** The beat on screen at epoch e: min(3, ⌊e/25⌋). */
export function beatIndex(e) {
  return clamp(Math.floor(e / (EPOCHS / BEATS)), 0, BEATS - 1);
}

// Surface (x, y, height) → the formation's local frame, before centring.
const cy = Math.cos(YAW);
const sy = Math.sin(YAW);
const ce = Math.cos(ELEVATION);
const se = Math.sin(ELEVATION);
function view(x, y, f, out) {
  const u = x * cy - y * sy;           // across the screen
  const v = x * sy + y * cy;           // into the screen (far side up)
  const h = f * HEIGHT;
  out[0] = u;
  out[1] = h * ce + v * se;
  out[2] = h * se - v * ce;
  return out;
}

let frame = null;
/** The surface's centre and extent in the view (sampled on the grid once): the box the camera frames. */
function surfaceFrame() {
  if (frame) return frame;
  const p = [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const n = 121;
  for (let i = 0; i < n; i++) {
    const x = -EXTENT + (2 * EXTENT * i) / (n - 1);
    for (let j = 0; j < n; j++) {
      const y = -EXTENT + (2 * EXTENT * j) / (n - 1);
      view(x, y, landscapeF(x, y), p);
      for (let a = 0; a < 3; a++) {
        if (p[a] < lo[a]) lo[a] = p[a];
        if (p[a] > hi[a]) hi[a] = p[a];
      }
    }
  }
  // A hair of margin: the grid particles between the samples can sit fractionally outside them.
  frame = {
    centre: lo.map((l, a) => (l + hi[a]) / 2),
    box: { w: (hi[0] - lo[0]) * 1.01, h: (hi[1] - lo[1]) * 1.01 },
  };
  return frame;
}

/** A surface point (x, y, f) in the landscape formation's centred local frame, as [X, Y, Z] (or into `out`). */
export function landscapeToLocal(x, y, f, out = [0, 0, 0]) {
  const { centre } = surfaceFrame();
  view(x, y, f, out);
  out[0] -= centre[0];
  out[1] -= centre[1];
  out[2] -= centre[2];
  return out;
}

/** The formation's box { w, h } (what buildLandscape returns and the camera frames), before anything is built. */
export function landscapeBox() {
  return { ...surfaceFrame().box };
}

let samples = null;
/**
 * The surface on a 25 × 25 grid over [−3, 3]², edges and corners included, in the centred local frame: X, Y, Z per
 * sample (computed once). The training stage projects these to keep the landscape clear of its text.
 */
export function surfaceSamples() {
  if (samples) return samples;
  const n = SAMPLE_GRID;
  samples = new Float32Array(n * n * 3);
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = -EXTENT + (2 * EXTENT * i) / (n - 1);
    for (let j = 0; j < n; j++) {
      const y = -EXTENT + (2 * EXTENT * j) / (n - 1);
      samples.set(landscapeToLocal(x, y, landscapeF(x, y), p), (i * n + j) * 3);
    }
  }
  return samples;
}

/**
 * N particles: a regular g × g grid (g = ⌊√(0.6·N)⌋), the next particles rejection-sampled onto the contour bands
 * |fract(6·f̂) − 0.5| < 0.08 (f̂ = f normalised to 0..1), and the last 15% dust. meta = f̂ (the height band), −1 for
 * dust. Shuffled, so any slice of the particles covers the whole surface.
 */
export function buildLandscape(N, { rng }) {
  const data = makeFormation(N);
  const { box } = surfaceFrame();
  const nDust = Math.round(N * (1 - SHARE.grid - SHARE.contour));
  const g = Math.floor(Math.sqrt(N * SHARE.grid));
  const nGrid = Math.min(g * g, N - nDust);
  const p = [0, 0, 0];
  const put = (i, x, y) => {
    const f = landscapeF(x, y);
    landscapeToLocal(x, y, f, p);
    data[i * 4] = p[0];
    data[i * 4 + 1] = p[1];
    data[i * 4 + 2] = p[2];
    data[i * 4 + 3] = normalised(f);
  };
  for (let i = 0; i < nGrid; i++) {
    const col = i % g;
    const row = Math.floor(i / g);
    put(i, -EXTENT + (2 * EXTENT * (col + 0.5)) / g, -EXTENT + (2 * EXTENT * (row + 0.5)) / g);
  }
  for (let i = nGrid; i < N - nDust; i++) {
    let x = 0;
    let y = 0;
    for (let t = 0; t < CONTOUR_TRIES; t++) {
      x = EXTENT * (2 * rng() - 1);
      y = EXTENT * (2 * rng() - 1);
      const band = (CONTOUR.levels * normalised(landscapeF(x, y))) % 1;
      if (Math.abs(band - 0.5) < CONTOUR.halfWidth) break;
    }
    put(i, x, y);
  }
  fillDust(data, N - nDust, N, { radius: DUST_RADIUS * box.w, rng });
  shuffle(data, 4, rng);
  return { data, box: { ...box }, minN: 1 };
}
