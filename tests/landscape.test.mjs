import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landscapeF, descentPath, gridMin, epochValues, formatHud, beatIndex } from '../js/engine/formations/landscape.js';
const P = descentPath();
test('101 steps', () => assert.equal(P.length, 101));
test('descent ends in the deeper well', () => { const m = gridMin(); assert.ok(Math.abs(landscapeF(P[100][0], P[100][1]) - m) <= 0.02 * Math.abs(m)); assert.ok(P[100][0] > 0); });
test('loss rescaling', () => {
  assert.ok(Math.abs(epochValues(0).train - 1.2) < 1e-9);
  assert.ok(Math.abs(epochValues(0).val - 1.248) < 1e-9);
  assert.ok(epochValues(100).train >= 0.18 - 1e-9 && epochValues(100).train < 0.2);
  assert.ok(Math.abs(epochValues(100).val - epochValues(100).train * 1.12) < 1e-9);
});
test('hud format', () => assert.match(formatHud(42.7), /^epoch 042 \/ 100 · train \d\.\d{3} · val \d\.\d{3} · lr 3e-3$/));
test('beats', () => assert.deepEqual([0, 24.9, 25, 50, 99, 100].map(beatIndex), [0, 0, 1, 2, 3, 3]));

// Beyond the brief's five: the formation builder, the path's mapping into the formation, the loss curve and the plot rect.
import { readFileSync } from 'node:fs';
import { buildLandscape, landscapeToLocal, surfaceSamples, pathAt, START, STEP, TAU, DENSE_STEPS } from '../js/engine/formations/landscape.js';
import { mulberry32 } from '../js/engine/formations/common.js';
import { curvePoints, plotRect, framedSurface, fitFrame, wantsSide } from '../js/sections/training.js';

const inBand = (meta) => Math.abs((6 * meta) % 1 - 0.5) < 0.08;

test('the descent starts at START, stays on the surface inside ±3, and z is the height', () => {
  assert.deepEqual(P[0].slice(0, 2), START);
  for (const [x, y, z] of P) {
    assert.ok(Math.abs(x) <= 3 && Math.abs(y) <= 3);
    assert.ok(Math.abs(z - landscapeF(x, y)) < 1e-12);
  }
  for (let k = 1; k <= 100; k++) assert.ok(P[k][2] < P[k - 1][2], `the loss falls every epoch (epoch ${k})`);
});

// Spec §2.4 (revised, Ruling R62): a dense fixed-step descent, resampled into 101 epochs on an exponential-progress
// schedule, so the loss decays like a real run's and the ball keeps moving, slowing, to the end.
test('P is the dense fixed-step descent from START, resampled at index(e) ∝ (1 − e^(−e/τ)) / (1 − e^(−100/τ))', () => {
  assert.ok(DENSE_STEPS >= 2000, `${DENSE_STEPS} dense steps`);
  assert.ok(STEP > 0 && Math.abs(TAU - 28) <= 1, `STEP ${STEP}, τ ${TAU}`);
  const h = 1e-4;
  const dense = [START.slice()];
  for (let k = 0; k < DENSE_STEPS; k++) {
    const [x, y] = dense[k];
    const gx = (landscapeF(x + h, y) - landscapeF(x - h, y)) / (2 * h);
    const gy = (landscapeF(x, y + h) - landscapeF(x, y - h)) / (2 * h);
    dense.push([x - STEP * gx, y - STEP * gy]);
  }
  for (let e = 0; e <= 100; e++) {
    const at = (DENSE_STEPS * (1 - Math.exp(-e / TAU))) / (1 - Math.exp(-100 / TAU));
    const k = Math.min(DENSE_STEPS - 1, Math.floor(at));
    const s = at - k;
    for (const i of [0, 1]) assert.ok(Math.abs(P[e][i] - (dense[k][i] + (dense[k + 1][i] - dense[k][i]) * s)) < 1e-9, `epoch ${e}`);
  }
});

const trains = Array.from({ length: 101 }, (_, e) => epochValues(e).train);

test('train never rises from one epoch to the next', () => {
  for (let e = 1; e <= 100; e++) assert.ok(trains[e] <= trains[e - 1], `epoch ${e}: ${trains[e]} after ${trains[e - 1]}`);
});

test('no cliff: after epoch 5 no one-epoch drop is more than twice the epoch before\'s', () => {
  for (let e = 6; e <= 100; e++) {
    const drop = trains[e - 1] - trains[e];
    const before = trains[e - 2] - trains[e - 1];
    assert.ok(drop <= 2 * before + 1e-6, `epoch ${e}: a drop of ${drop.toFixed(4)} after ${before.toFixed(4)}`);
  }
});

test('the ball keeps moving, slowing, through the last beats: P(40), P(60) and P(80) differ', () => {
  const [p40, p60, p80] = [40, 60, 80].map((e) => pathAt(e, [0, 0, 0]));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.ok(dist(p40, p60) > 0.01 && dist(p60, p80) > 0.01, `moves ${dist(p40, p60).toFixed(4)}, then ${dist(p60, p80).toFixed(4)}`);
  assert.ok(dist(p60, p80) < dist(p40, p60), 'and slows');
});

// The no-JS page shows the HUD's sample line (epoch 042) over the run's own curve, drawn to epoch 42 every second epoch.
test('the no-JS loss curve in index.html is the run to epoch 42, one point every second epoch', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const shown = (series) => html.match(new RegExp(`<polyline class="${series}" points="([^"]*)"`))[1];
  const drawn = (loss) => Array.from({ length: 22 }, (_, i) => `${4 * i},${(80 * (1 - loss(2 * i) / 1.3)).toFixed(1)}`).join(' ');
  assert.equal(shown('train'), drawn((e) => epochValues(e).train));
  assert.equal(shown('val'), drawn((e) => epochValues(e).val));
});

test('fractional epochs sit between their neighbours and clamp to 0..100', () => {
  const [a, b, c] = [12, 12.5, 13].map((e) => epochValues(e).train);   // on the way down
  assert.ok(a > b && b > c);
  assert.deepEqual(epochValues(-5), epochValues(0));
  assert.deepEqual(epochValues(130), epochValues(100));
  assert.match(formatHud(100), /^epoch 100 \/ 100 /);
  assert.match(formatHud(0), /^epoch 000 \/ 100 · train 1\.200 · val 1\.248 · lr 3e-3$/);
});

test('landscape formation: N particles, 15% dust, the rest on the surface with meta = normalised height', () => {
  const N = 6000;
  const f = buildLandscape(N, { rng: mulberry32(7) });
  assert.equal(f.data.length, N * 4);
  assert.ok(f.box.w > 0 && f.box.h > 0);
  let dust = 0;
  let band = 0;
  for (let i = 0; i < N; i++) {
    const [x, y, z, meta] = f.data.subarray(i * 4, i * 4 + 4);
    assert.ok([x, y, z].every(Number.isFinite));
    if (meta === -1) { dust++; continue; }
    assert.ok(meta >= 0 && meta <= 1);
    assert.ok(Math.abs(x) <= f.box.w / 2 + 1e-4 && Math.abs(y) <= f.box.h / 2 + 1e-4, 'surface particles lie inside the box');
    if (inBand(meta)) band++;
  }
  assert.equal(dust, Math.round(0.15 * N));
  // 25% of N is placed on the contour bands; some of the regular grid falls on them too.
  assert.ok(band >= 0.25 * N && band < 0.5 * N, `${band} particles on the contour bands`);
});

test('landscape formation is deterministic for a seed', () => {
  const a = buildLandscape(3000, { rng: mulberry32(11) });
  const b = buildLandscape(3000, { rng: mulberry32(11) });
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(a.box, b.box);
});

test('the descent path maps into the landscape box', () => {
  const { box } = buildLandscape(2000, { rng: mulberry32(1) });
  for (const [x, y, z] of P) {
    const [X, Y] = landscapeToLocal(x, y, z);
    assert.ok(Math.abs(X) <= box.w / 2 && Math.abs(Y) <= box.h / 2);
  }
});

test('loss curve points: x = 2·epoch, y = 80·(1 − loss / 1.3), with a fractional end', () => {
  const values = Array.from({ length: 101 }, (_, k) => 1.3 - k * 0.01);
  assert.equal(curvePoints(values, 0), '0.00,0.00');
  assert.equal(curvePoints(values, 2), '0.00,0.00 2.00,0.62 4.00,1.23');
  assert.equal(curvePoints(values, 1.5), '0.00,0.00 2.00,0.62 3.00,0.92');
  assert.equal(curvePoints(values, 100).split(' ').length, 101);
  assert.equal(curvePoints(values, 250), curvePoints(values, 100));
});

// The stage as measured in the browser (CSS px; rects relative to the held stage's top): 1440 × 900, 1024 × 768,
// 768 × 1024 (HUD beside the heading from 768 px up), 390 × 844 (HUD stacked under it) and 844 × 390 (a phone on its side).
const D1440 = { vw: 1440, vh: 900, stageH: 900, headerBottom: 64, head: { x: 48, y: 88, w: 434, h: 66 }, hud: { x: 1032, y: 88, w: 360, h: 139 }, beatsTop: 633 };
const L1024 = { vw: 1024, vh: 768, stageH: 768, headerBottom: 64, head: { x: 34, y: 88, w: 348, h: 53 }, hud: { x: 630, y: 88, w: 360, h: 139 }, beatsTop: 505 };
const T768 = { vw: 768, vh: 1024, stageH: 1024, headerBottom: 64, head: { x: 26, y: 88, w: 296, h: 45 }, hud: { x: 382, y: 88, w: 360, h: 139 }, beatsTop: 761 };
const P390 = { vw: 390, vh: 844, stageH: 844, headerBottom: 64, head: { x: 16, y: 88, w: 217, h: 33 }, hud: { x: 16, y: 141, w: 358, h: 99 }, beatsTop: 653 };
const L844 = { vw: 844, vh: 390, stageH: 390, headerBottom: 64, head: { x: 28, y: 88, w: 311, h: 47 }, hud: { x: 456, y: 88, w: 360, h: 139 }, beatsTop: 129 };
const VIEW = { vfov: 35, roll: 2.5 };
const at = (m) => ({ ...m, ...VIEW });

/** How many surface samples of the landscape framed into `rect` land within `pad` px of any of `rects`. */
function covered(rect, m, rects, pad = 16) {
  const pts = framedSurface(rect, at(m));
  let n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const [x, y] = [pts[i], pts[i + 1]];
    if (rects.some((r) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad)) n++;
  }
  return n;
}

/** The bounds { x0, x1, y0, y1 } of the surface as it lands on screen when framed into `rect`. */
function shown(rect, m) {
  const pts = framedSurface(rect, at(m));
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let i = 0; i < pts.length; i += 2) {
    b.x0 = Math.min(b.x0, pts[i]); b.x1 = Math.max(b.x1, pts[i]);
    b.y0 = Math.min(b.y0, pts[i + 1]); b.y1 = Math.max(b.y1, pts[i + 1]);
  }
  return b;
}

test('framed surface: one point per surface sample, inside the rect the box is framed into when it is centred', () => {
  const rect = { x: 0, y: 64, w: 1440, h: 431 };
  assert.equal(framedSurface(rect, at(D1440)).length, 2 * surfaceSamples().length / 3);
  const b = shown(rect, D1440);
  assert.ok(b.x0 >= 0 && b.x1 <= 1440 && b.y0 >= 64 && b.y1 <= 495);
});

test('fitFrame: the framed surface centred in the target, its binding side the target less the 8% slack', () => {
  for (const [m, target] of [
    [D1440, { x: 0, y: 64, w: 1440, h: 431 }],
    [P390, { x: 0, y: 256, w: 390, h: 208 }],
    [L844, { x: 456, y: 203, w: 388, h: 171 }],           // off-axis: perspective alone would push it off the stage
  ]) {
    const b = shown(fitFrame(target, at(m)), m);
    const near = (a, e) => Math.abs(a - e) < 1;
    assert.ok(near((b.x0 + b.x1) / 2, target.x + target.w / 2) && near((b.y0 + b.y1) / 2, target.y + target.h / 2), 'centred');
    const k = Math.max((b.x1 - b.x0) / target.w, (b.y1 - b.y0) / target.h);
    assert.ok(Math.abs(k - 1 / 1.08) < 0.005, `binding side ${k}`);
  }
});

test('plot at 1440 × 900: the landscape in the upper 55% of the stage, below the header, clear of the heading and the HUD', () => {
  const rect = plotRect(at(D1440));
  const b = shown(rect, D1440);
  assert.ok(b.y0 >= 64 && b.y1 <= 495 && b.x0 >= 0 && b.x1 <= 1440);
  assert.ok(b.y1 - b.y0 > 340, `${Math.round(b.y1 - b.y0)} px tall`);
  assert.equal(covered(rect, D1440, [D1440.head, D1440.hud]), 0);
});

test('plot at 1024 × 768 and 768 × 1024: clear of the heading and the HUD beside it, in the upper 55%', () => {
  for (const m of [L1024, T768]) {
    const rect = plotRect(at(m));
    const b = shown(rect, m);
    assert.ok(b.y0 >= 64 && b.y1 <= 0.55 * m.stageH && b.x0 >= 0 && b.x1 <= m.vw);
    assert.equal(covered(rect, m, [m.head, m.hud]), 0);
  }
});

test('plot on a phone: below the stacked HUD, in the upper 55% of the stage', () => {
  const b = shown(plotRect(at(P390)), P390);
  assert.ok(b.y0 >= 240 + 16 && b.y1 <= 0.55 * 844 && b.x0 >= 0 && b.x1 <= 390);
  assert.ok(b.x1 - b.x0 > 0.9 * 390 / 1.08, 'as wide as the phone allows');
});

test('the side layout only when the beats would run into the heading or the HUD', () => {
  for (const m of [D1440, L1024, T768, P390]) assert.equal(wantsSide(m), false);
  assert.equal(wantsSide(L844), true);
  // 667 × 375, HUD stacked under the heading: the beats would sit on the HUD.
  assert.equal(wantsSide({ stageH: 375, headerBottom: 64, head: { x: 22, y: 88, w: 272, h: 45 }, hud: { x: 22, y: 153, w: 623, h: 99 }, beatsTop: 147 }), true);
});

test('side layout: the landscape in the right column, below the HUD, on the stage', () => {
  const side = { ...L844, hud: { x: 456, y: 88, w: 360, h: 99 }, side: true };
  const b = shown(plotRect(at(side)), side);
  assert.ok(b.x0 >= 456 && b.x1 <= 844 && b.y0 >= 88 + 99 + 16 && b.y1 <= 390 - 16, JSON.stringify(b));
});

// Phones on their side, from 768 px wide, as measured in the browser: in the regular layout, where the side layout is
// decided, and then in the side layout with its tighter beat (css/sections/training.css). 812 × 375 is the iPhone X–13
// mini; 768 × 360 is the narrowest beat column and a stage shorter still.
const SIDE_STAGES = [
  [{ vw: 812, vh: 375, stageH: 375, headerBottom: 64, head: { x: 27, y: 88, w: 304, h: 46 }, hud: { x: 425, y: 88, w: 360, h: 139 }, beatsTop: 115 },
    { hud: { x: 425, y: 88, w: 360, h: 99 }, beats: { x: 27, y: 146, w: 367, h: 122 } }],
  [L844, { hud: { x: 456, y: 88, w: 360, h: 99 }, beats: { x: 28, y: 147, w: 382, h: 123 } }],
  [{ vw: 768, vh: 360, stageH: 360, headerBottom: 64, head: { x: 26, y: 88, w: 295, h: 45 }, hud: { x: 382, y: 88, w: 360, h: 139 }, beatsTop: 100 },
    { hud: { x: 396, y: 88, w: 346, h: 115 }, beats: { x: 26, y: 145, w: 346, h: 122 } }],
];
// From 768 px the fixed section HUD owns the bottom-left 210 × 70 px of the viewport (Ruling R54).
const HUD_ZONE = { w: 210, h: 70 };

test('side layout from 768 px: the beat ends 70 px or more above the stage bottom, clear of the HUD zone (R54)', () => {
  for (const [regular, laidOut] of SIDE_STAGES) {
    const m = { ...regular, ...laidOut, side: true };
    const { beats, stageH, vw } = m;
    assert.equal(wantsSide(regular), true, `${vw} × ${stageH} takes the side layout`);
    assert.ok(beats.x < HUD_ZONE.w, 'the beat column starts over the zone, so only its bottom keeps it out');
    assert.ok(beats.y + beats.h <= stageH - HUD_ZONE.h, `${vw} × ${stageH}: beats end at ${beats.y + beats.h}, the zone starts at ${stageH - HUD_ZONE.h}`);
    assert.ok(beats.y >= m.head.y + m.head.h, 'under the heading');
    // The landscape keeps to the right column: beside the beats, under the HUD, on the stage.
    const b = shown(plotRect(at(m)), m);
    assert.ok(b.x0 >= beats.x + beats.w && b.x1 <= vw && b.y0 >= m.hud.y + m.hud.h && b.y1 <= stageH, JSON.stringify(b));
  }
});

test('plot never collapses on a stage too short for everything', () => {
  const b = shown(plotRect(at(L844)), L844);
  assert.ok(b.y1 - b.y0 >= 0.2 * 390 / 1.08 - 1 && b.y0 >= 64);
});

// A classic training curve (Rulings R59, R62): a fast early drop, then a long, slowing tail into the deeper well.
test('the loss drops fast, then slows: ≤ 0.60 by epoch 25, ≤ 0.30 by epoch 60', () => {
  assert.ok(epochValues(25).train <= 0.6, `epoch 25: ${epochValues(25).train.toFixed(3)}`);
  assert.ok(epochValues(60).train <= 0.3, `epoch 60: ${epochValues(60).train.toFixed(3)}`);
});
test('the HUD\'s train readout never ticks up as the epoch runs, and never reads under 0.180', () => {
  let prev = Infinity;
  for (let i = 0; i <= 2000; i++) {
    const e = i / 20;
    const { train } = epochValues(e);
    assert.ok(train >= 0.18, `epoch ${e}: ${train}`);
    const shown = Number(formatHud(e).match(/train (\d\.\d{3})/)[1]);
    assert.ok(shown <= prev, `epoch ${e}: ${shown} after ${prev}`);
    prev = shown;
  }
});

test('side layout on a stage too short for it: the plot keeps a fifth of the stage, never an empty rect', () => {
  const tiny = { vw: 812, vh: 200, stageH: 200, headerBottom: 64, head: { x: 27, y: 88, w: 304, h: 46 }, hud: { x: 425, y: 88, w: 360, h: 99 }, side: true };
  const rect = plotRect(at(tiny));
  assert.ok([rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0, JSON.stringify(rect));
  const b = shown(rect, tiny);
  assert.ok(b.y1 - b.y0 >= 0.2 * 200 / 1.08 - 1, JSON.stringify(b));
});
