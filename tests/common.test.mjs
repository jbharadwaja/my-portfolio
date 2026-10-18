import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, systematicSample } from '../js/engine/formations/common.js';
test('deterministic rng', () => assert.equal(mulberry32(7)(), mulberry32(7)()));
test('systematic sampling is proportional', () => {
  const uv = systematicSample(Float32Array.from([0, 1, 0, 3]), 4, 1, 400, mulberry32(1));
  const counts = [0, 0, 0, 0]; for (let i = 0; i < 400; i++) counts[Math.floor(uv[i * 2] * 4)]++;
  assert.deepEqual(counts, [0, 100, 0, 300]);
});

// Beyond the brief: the other helpers and the two formations of this task.
import { makeFormation, fillDust, shuffle } from '../js/engine/formations/common.js';
import { buildNoise } from '../js/engine/formations/noise.js';
import { buildGalaxy } from '../js/engine/formations/galaxy.js';

test('rng stays in [0, 1) and differs by seed', () => {
  const r = mulberry32(42);
  for (let i = 0; i < 10000; i++) { const x = r(); assert.ok(x >= 0 && x < 1); }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});
test('sampling covers rows and jitters inside the cell', () => {
  const w = new Float32Array(6); w[4] = 1;          // gw 3, gh 2: only cell (1, 1)
  const uv = systematicSample(w, 3, 2, 50, mulberry32(9));
  for (let i = 0; i < 50; i++) {
    assert.ok(uv[i * 2] >= 1 / 3 && uv[i * 2] < 2 / 3);
    assert.ok(uv[i * 2 + 1] >= 0.5 && uv[i * 2 + 1] < 1);
  }
  assert.notEqual(uv[0], uv[2]);
});
test('makeFormation is N × (x, y, z, meta)', () => assert.equal(makeFormation(10).length, 40));
test('dust fills its range with meta −1 inside the radius', () => {
  const d = makeFormation(100);
  fillDust(d, 60, 100, { radius: 5, rng: mulberry32(3) });
  for (let i = 0; i < 60; i++) assert.equal(d[i * 4 + 3], 0);
  for (let i = 60; i < 100; i++) {
    assert.equal(d[i * 4 + 3], -1);
    assert.ok(Math.hypot(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) <= 5);
  }
});
test('shuffle keeps records whole', () => {
  const d = new Float32Array(400);
  for (let i = 0; i < 100; i++) d.set([i, i, i, i], i * 4);
  shuffle(d, 4, mulberry32(4));
  const seen = new Set();
  for (let i = 0; i < 100; i++) { assert.ok(d[i * 4] === d[i * 4 + 3]); seen.add(d[i * 4]); }
  assert.equal(seen.size, 100);
  assert.notDeepEqual(Array.from(d.slice(0, 8)), [0, 0, 0, 0, 1, 1, 1, 1]);
});
test('noise is a centred gaussian with σ = 2.2', () => {
  const N = 20000;
  const f = buildNoise(N, { rng: mulberry32(1) });
  assert.equal(f.data.length, N * 4);
  const mean = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) { mean[a] += f.data[i * 4 + a] / N; sq[a] += f.data[i * 4 + a] ** 2 / N; }
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs(mean[a]) < 0.06, `mean ${mean[a]}`);
    assert.ok(Math.abs(Math.sqrt(sq[a] - mean[a] ** 2) - 2.2) < 0.06, `σ ${Math.sqrt(sq[a])}`);
  }
  assert.ok(f.box.w > 0 && f.box.h > 0 && f.minN >= 1);
});
test('galaxy is a centred formation that fits its box', () => {
  const N = 20000;
  const f = buildGalaxy(N, { rng: mulberry32(2) });
  assert.equal(f.data.length, N * 4);
  let inside = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < N; i++) {
    const x = f.data[i * 4];
    const y = f.data[i * 4 + 1];
    cx += x / N;
    cy += y / N;
    if (Math.abs(x) <= f.box.w / 2 && Math.abs(y) <= f.box.h / 2) inside++;
    assert.ok(Number.isFinite(f.data[i * 4 + 2]));
  }
  assert.ok(Math.abs(cx) < 0.1 && Math.abs(cy) < 0.1);
  assert.ok(inside / N > 0.97, `${inside / N} inside the box`);
});
test('builders are deterministic for a seed', () => {
  assert.deepEqual(buildGalaxy(500, { rng: mulberry32(5) }).data, buildGalaxy(500, { rng: mulberry32(5) }).data);
});
