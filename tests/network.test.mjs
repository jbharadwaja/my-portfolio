import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_LAYERS, networkNodes, buildNetwork } from '../js/engine/formations/network.js';
import { mulberry32 } from '../js/engine/formations/common.js';
import { activeLayer } from '../js/sections/encoder.js';
test('19 nodes by layer', () => {
  const n = networkNodes({ vertical: false });
  assert.equal(n.length, 19);
  assert.deepEqual(NETWORK_LAYERS.map((c, l) => n.filter((x) => x.layer === l).length), [4, 6, 6, 3]);
});
test('vertical puts inputs on top', () => {
  const n = networkNodes({ vertical: true });
  assert.ok(Math.min(...n.filter((x) => x.layer === 0).map((x) => x.y)) > Math.max(...n.filter((x) => x.layer === 3).map((x) => x.y)));
});
test('allocation and meta', () => {
  const N = 10000, f = buildNetwork(N, { vertical: false, rng: mulberry32(2) });
  let dust = 0; for (let i = 0; i < N; i++) { const m = f.data[i * 4 + 3]; if (m === -1) dust++; else assert.ok(m >= 0 && m <= 1); }
  assert.equal(dust, 1500);
});
test('active layer', () => { assert.equal(activeLayer(0), 0); assert.equal(activeLayer(0.33), 0); assert.equal(activeLayer(0.3334), 1); assert.equal(activeLayer(1), 3); });
