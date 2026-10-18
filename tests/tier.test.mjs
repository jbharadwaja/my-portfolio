import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTier, computeDpr, shouldIgnoreResize, readEnv, overFrameBudget } from '../js/engine/tier.js';
const t = (e) => pickTier({ saveData: false, deviceMemory: 8, coarse: false, fine: true, ...e });
test('saver first', () => assert.deepEqual(t({ saveData: true, innerWidth: 1440 }), { name: 'saver', N: 10000, dust: 400, dprCap: 1, renderCap: 30, repulsion: false }));
test('narrow fine window is mobile', () => assert.equal(t({ innerWidth: 700 }).name, 'mobile'));
test('coarse under 1024 is mobile', () => assert.equal(t({ coarse: true, fine: false, innerWidth: 900 }).N, 14000));
test('desktop', () => assert.deepEqual(t({ innerWidth: 1440 }), { name: 'desktop', N: 48000, dust: 3000, dprCap: 1.5, renderCap: 0, repulsion: true }));
test('laptop fine', () => assert.deepEqual(t({ innerWidth: 1100 }), { name: 'laptop', N: 28000, dust: 1500, dprCap: 1.25, renderCap: 60, repulsion: true }));
test('tablet coarse has no repulsion', () => assert.equal(t({ coarse: true, fine: false, innerWidth: 1180 }).repulsion, false));
test('dpr budget', () => {
  assert.equal(computeDpr(1.5, 1440, 900), 1.5);
  assert.equal(computeDpr(1.5, 3840, 2160), 1.0);
  assert.ok(Math.abs(computeDpr(1.25, 1920, 1080) - 1.2423) < 1e-3);
});
test('iOS URL-bar resizes ignored', () => {
  assert.equal(shouldIgnoreResize({ w: 390, h: 844 }, { w: 390, h: 760 }, true), true);
  assert.equal(shouldIgnoreResize({ w: 390, h: 844 }, { w: 390, h: 500 }, true), false);
  assert.equal(shouldIgnoreResize({ w: 1440, h: 900 }, { w: 1440, h: 800 }, false), false);
});

test('low device memory is saver; unknown memory is not', () => {
  assert.equal(t({ deviceMemory: 2, innerWidth: 1440 }).name, 'saver');
  assert.equal(t({ deviceMemory: null, innerWidth: 1440 }).name, 'desktop');
});
test('the full mobile and saver rows', () => {
  assert.deepEqual(t({ innerWidth: 390 }), { name: 'mobile', N: 14000, dust: 800, dprCap: 1, renderCap: 60, repulsion: false });
  const saver = { name: 'saver', N: 10000, dust: 400, dprCap: 1, renderCap: 30, repulsion: false };
  assert.deepEqual(t({ deviceMemory: 1, coarse: true, fine: false, innerWidth: 390 }), saver);
  assert.deepEqual(t({ saveData: true, coarse: true, fine: false, innerWidth: 1180 }), saver);
  assert.equal(t({ coarse: true, fine: false, innerWidth: 1440 }).name, 'laptop');
});
test('breakpoint edges: 767/768 fine, 1023/1024 coarse, 1279/1280 fine', () => {
  assert.equal(t({ innerWidth: 767 }).name, 'mobile');
  assert.deepEqual(t({ innerWidth: 768 }), { name: 'laptop', N: 28000, dust: 1500, dprCap: 1.25, renderCap: 60, repulsion: true });
  const coarse = (innerWidth) => t({ coarse: true, fine: false, innerWidth });
  assert.equal(coarse(1023).name, 'mobile');
  assert.deepEqual(coarse(1024), { name: 'laptop', N: 28000, dust: 1500, dprCap: 1.25, renderCap: 60, repulsion: false });
  assert.equal(t({ innerWidth: 1279 }).name, 'laptop');
  assert.equal(t({ innerWidth: 1280 }).name, 'desktop');
});
test('coarse resizes that change the width are never ignored', () => {
  assert.equal(shouldIgnoreResize({ w: 390, h: 844 }, { w: 391, h: 844 }, true), false);
  assert.equal(shouldIgnoreResize({ w: 390, h: 844 }, { w: 400, h: 800 }, true), false);
  assert.equal(shouldIgnoreResize({ w: 390, h: 844 }, { w: 844, h: 390 }, true), false);   // rotation
});
test('the URL-bar slack is strictly under 25% of the height, both ways', () => {
  assert.equal(shouldIgnoreResize({ w: 400, h: 800 }, { w: 400, h: 601 }, true), true);
  assert.equal(shouldIgnoreResize({ w: 400, h: 800 }, { w: 400, h: 600 }, true), false);   // exactly 25%
  assert.equal(shouldIgnoreResize({ w: 400, h: 800 }, { w: 400, h: 999 }, true), true);
  assert.equal(shouldIgnoreResize({ w: 400, h: 800 }, { w: 400, h: 1000 }, true), false);  // exactly 25%
});
test('adaptive quality: p75 over max(20 ms, 1.25 × median) steps down; a steady 30 Hz does not', () => {
  const frames = (...runs) => Float32Array.from(runs.flatMap(([n, ms]) => Array(n).fill(ms))).sort();
  assert.equal(overFrameBudget(frames([120, 16.7])), false);              // 60 Hz
  assert.equal(overFrameBudget(frames([120, 33.3])), false);              // 30 Hz rAF (iOS Low Power Mode)
  assert.equal(overFrameBudget(frames([60, 32], [60, 34.5])), false);     // 30 Hz with jitter
  assert.equal(overFrameBudget(frames([60, 16.7], [60, 33.3])), true);    // 60 Hz dropping every other frame
  assert.equal(overFrameBudget(frames([80, 16.7], [40, 40])), true);      // a third of the frames at 25 fps
  assert.equal(overFrameBudget(frames([90, 16.7], [30, 50])), false);     // p75 still on time
  assert.equal(overFrameBudget(frames([120, 20])), false);                // exactly the budget
  assert.equal(overFrameBudget(new Float32Array(0)), false);
});
test('readEnv reads the browser, tolerating missing APIs', () => {
  const win = (navigator, coarse) => ({ navigator, innerWidth: 800, matchMedia: (q) => ({ matches: q === (coarse ? '(pointer: coarse)' : '(pointer: fine)') }) });
  assert.deepEqual(readEnv(win({ connection: { saveData: true }, deviceMemory: 4 }, true)), { saveData: true, deviceMemory: 4, innerWidth: 800, coarse: true, fine: false });
  assert.deepEqual(readEnv(win({}, false)), { saveData: false, deviceMemory: null, innerWidth: 800, coarse: false, fine: true });
});
