import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameDistance, rectShift, lerpPose } from '../js/engine/framing.js';
const full = { x: 0, y: 0, w: 1440, h: 900 };
test('full-viewport framing', () => assert.ok(Math.abs(frameDistance({ w: 4, h: 4 }, full, 1440, 900, 35) - 6.851) < 1e-3));
test('half-height rect doubles distance', () => assert.ok(Math.abs(frameDistance({ w: 4, h: 4 }, { x: 0, y: 450, w: 1440, h: 450 }, 1440, 900, 35) - 13.702) < 2e-3));
test('centred rect needs no shift', () => { const s = rectShift(full, 1440, 900, 6.851, 35); assert.ok(Math.abs(s.dx) < 1e-9 && Math.abs(s.dy) < 1e-9); });
test('rect on the right shifts the camera left', () => assert.ok(rectShift({ x: 720, y: 0, w: 720, h: 900 }, 1440, 900, 6.851, 35).dx < 0));

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
test('a wide box on a portrait screen is framed by its width', () => {
  // (w/2)/(tan(17.5°)·aspect) · vw/rect.w · 1.08 with aspect 390/844
  near(frameDistance({ w: 4, h: 1 }, { x: 0, y: 0, w: 390, h: 844 }, 390, 844, 35), 1.08 * 2 / (Math.tan(17.5 * Math.PI / 180) * 390 / 844), 1e-9);
});
test('the shift puts the box centre on the rect centre', () => {
  // right half, lower half: the rect centre sits at NDC (0.5, -0.5)
  const d = 10, half = d * Math.tan(17.5 * Math.PI / 180);
  const s = rectShift({ x: 720, y: 450, w: 720, h: 450 }, 1440, 900, d, 35);
  near(s.dx, -0.5 * half * 1440 / 900);
  near(s.dy, 0.5 * half);
});
test('lerpPose blends every field and can write into a reused object', () => {
  const a = { x: 0, y: 2, z: 10, roll: -2 };
  const b = { x: 4, y: -2, z: -20, roll: 2 };
  assert.deepEqual(lerpPose(a, b, 0.25), { x: 1, y: 1, z: 2.5, roll: -1 });
  const out = { x: 9, y: 9, z: 9, roll: 9 };
  assert.equal(lerpPose(a, b, 1, out), out);
  assert.deepEqual(out, b);
});
