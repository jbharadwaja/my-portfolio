import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTier, computeDpr, shouldIgnoreResize, readEnv } from '../js/engine/tier.js';
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
  assert.equal(t({ coarse: true, fine: false, innerWidth: 1440 }).name, 'laptop');
});
test('readEnv reads the browser, tolerating missing APIs', () => {
  const win = (navigator, coarse) => ({ navigator, innerWidth: 800, matchMedia: (q) => ({ matches: q === (coarse ? '(pointer: coarse)' : '(pointer: fine)') }) });
  assert.deepEqual(readEnv(win({ connection: { saveData: true }, deviceMemory: 4 }, true)), { saveData: true, deviceMemory: 4, innerWidth: 800, coarse: true, fine: false });
  assert.deepEqual(readEnv(win({}, false)), { saveData: false, deviceMemory: null, innerWidth: 800, coarse: false, fine: true });
});
