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
import { buildLandscape, landscapeToLocal, surfaceSamples, START, STEP } from '../js/engine/formations/landscape.js';
import { mulberry32 } from '../js/engine/formations/common.js';
import { curvePoints, plotRect, framedSurface, fitFrame, wantsSide } from '../js/sections/training.js';

const inBand = (meta) => Math.abs((6 * meta) % 1 - 0.5) < 0.08;

test('the descent starts at START, takes fixed steps and z is the height', () => {
  assert.deepEqual(P[0].slice(0, 2), START);
  assert.ok(STEP > 0);
  for (const [x, y, z] of P) {
    assert.ok(Math.abs(x) <= 3 && Math.abs(y) <= 3);
    assert.ok(Math.abs(z - landscapeF(x, y)) < 1e-12);
  }
  for (let k = 1; k <= 100; k++) assert.ok(P[k][2] < P[k - 1][2], `the loss falls at every step (step ${k})`);
});

test('fractional epochs sit between their neighbours and clamp to 0..100', () => {
  const [a, b, c] = [42, 42.5, 43].map((e) => epochValues(e).train);
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

test('plot never collapses on a stage too short for everything', () => {
  const b = shown(plotRect(at(L844)), L844);
  assert.ok(b.y1 - b.y0 >= 0.2 * 390 / 1.08 - 1 && b.y0 >= 64);
});
