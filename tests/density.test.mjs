import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alphaForPoints, sizeScale } from '../js/engine/density.js';
test('one dense blob gets the floor', () => assert.equal(alphaForPoints(new Float32Array(2000).fill(0.01)), 0.06));
test('one point per cell gets the ceiling', () => {
  const p = new Float32Array(64 * 64 * 2);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) { p[(j * 64 + i) * 2] = (i + 0.5) / 32 - 1; p[(j * 64 + i) * 2 + 1] = (j + 0.5) / 32 - 1; }
  assert.equal(alphaForPoints(p), 0.85);
});
test('size scale by tier', () => { assert.equal(sizeScale(48000), 1); assert.ok(Math.abs(sizeScale(14000) - 1.8516) < 1e-3); assert.equal(sizeScale(10000), 2); });

// Beyond the brief.
test('k is the 99th percentile of the occupied cells', () => {
  // 99 cells hold 1 point, one cell holds 50: the 99th percentile (nearest rank) is still 1 → the ceiling.
  const p = [];
  for (let i = 0; i < 99; i++) p.push((i % 64 + 0.5) / 32 - 1, (Math.floor(i / 64) + 0.5) / 32 - 1);
  for (let i = 0; i < 50; i++) p.push(0.9, 0.9);
  assert.equal(alphaForPoints(Float32Array.from(p)), 0.85);
  // 10 points in each of 100 cells → k = 10 → 0.19.
  const q = [];
  for (let c = 0; c < 100; c++) for (let i = 0; i < 10; i++) q.push((c % 64 + 0.5) / 32 - 1, (Math.floor(c / 64) + 0.5) / 32 - 1);
  assert.ok(Math.abs(alphaForPoints(Float32Array.from(q)) - 0.19) < 1e-9);
});
test('points off screen are not binned', () => {
  const p = new Float32Array(4000).fill(3);       // all outside [−1, 1]²
  p[0] = 0; p[1] = 0;                             // one on screen
  assert.equal(alphaForPoints(p), 0.85);
});
test('nothing on screen gets the ceiling', () => assert.equal(alphaForPoints(new Float32Array(10).fill(-2)), 0.85));
test('footprint converts cell counts into per-pixel overlap', () => {
  const q = [];
  for (let c = 0; c < 100; c++) for (let i = 0; i < 40; i++) q.push((c % 64 + 0.5) / 32 - 1, (Math.floor(c / 64) + 0.5) / 32 - 1);
  const pts = Float32Array.from(q);
  assert.equal(alphaForPoints(pts), 0.06);                            // k = 40 counts → floor
  assert.equal(alphaForPoints(pts, 64, 0.05), 0.85);                  // k = 40 · 0.05 = 2 → 0.95 → ceiling
  assert.ok(Math.abs(alphaForPoints(pts, 64, 0.1) - 0.475) < 1e-9);   // k = 4 → 1.9 / 4
});
