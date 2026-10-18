import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, applyEntrance, needsDip, limitRate } from '../js/engine/resolver.js';
const B = (...v) => Float32Array.from([...v, ...Array(7 - v.length).fill(0)]);
test('nothing scrolled', () => assert.deepEqual(resolve(B()), { from: 0, to: 1, mix: 0 }));
test('mid hero→encoder', () => assert.deepEqual(resolve(B(1, 0.5)), { from: 1, to: 2, mix: 0.5 }));
test('later boundary wins on overlap', () => assert.deepEqual(resolve(B(1, 1, 0.4, 0.2)), { from: 3, to: 4, mix: Math.fround(0.2) }));
test('last boundary snaps', () => assert.deepEqual(resolve(B(1, 1, 1, 1, 1, 1, 0.996)), { from: 6, to: 7, mix: 1 }));
test('entrance holds the hero', () => { const b = B(0, 0.4); applyEntrance(b, 0.3); assert.deepEqual([b[0], b[1]], [Math.fround(0.3), 0]); });
test('dip only for a mid-morph pair change', () => {
  assert.equal(needsDip({ from: 2, to: 3, mix: 0.5 }, { from: 4, to: 5, mix: 0.1 }), true);
  assert.equal(needsDip({ from: 2, to: 3, mix: 1 }, { from: 3, to: 4, mix: 0 }), false);
  assert.equal(needsDip({ from: 2, to: 3, mix: 0.5 }, { from: 2, to: 3, mix: 0.6 }), false);
});
test('night follows at ≤ 2.5/s', () => { assert.equal(limitRate(0, 1, 2.5, 0.1), 0.25); assert.equal(limitRate(0.9, 1, 2.5, 0.1), 1); });

// Beyond the brief: edges of the same rules.
test('the entrance alone morphs noise → hero', () => assert.deepEqual(resolve(B(0.25)), { from: 0, to: 1, mix: 0.25 }));
test('a full boundary below the snap holds its formation', () => assert.deepEqual(resolve(B(1, 1, 1, 1, 1, 1, 0.99)), { from: 6, to: 7, mix: Math.fround(0.99) }));
test('a finished entrance leaves the hero formed and the scroll free', () => {
  const b = B(0, 0.4);
  applyEntrance(b, 1);
  assert.deepEqual([b[0], b[1]], [1, Math.fround(0.4)]);
  assert.deepEqual(resolve(b), { from: 1, to: 2, mix: Math.fround(0.4) });
});
test('dip window is 0.02–0.98 (exclusive)', () => {
  assert.equal(needsDip({ from: 1, to: 2, mix: 0.02 }, { from: 3, to: 4, mix: 0 }), false);
  assert.equal(needsDip({ from: 1, to: 2, mix: 0.98 }, { from: 3, to: 4, mix: 0 }), false);
  assert.equal(needsDip({ from: 1, to: 2, mix: 0.03 }, { from: 1, to: 3, mix: 0 }), true);
});
test('rate limit works downwards and never overshoots', () => {
  assert.equal(limitRate(1, 0, 2.5, 0.1), 0.75);
  assert.equal(limitRate(0.1, 0, 2.5, 0.1), 0);
  assert.equal(limitRate(0.5, 0.5, 2.5, 0.1), 0.5);
});
test('resolve writes into a reused object', () => {
  const out = { from: 9, to: 9, mix: 9 };
  assert.equal(resolve(B(1, 1, 0.25), out), out);
  assert.deepEqual(out, { from: 2, to: 3, mix: 0.25 });
  resolve(B(), out);
  assert.deepEqual(out, { from: 0, to: 1, mix: 0 });
});
