import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAllocation, routeLegs, greatCircle, buildWorldMap } from '../js/engine/formations/worldmap.js';
import { mulberry32 } from '../js/engine/formations/common.js';
import { routeTimeline } from '../js/sections/route.js';
test('allocation by tier', () => {
  assert.deepEqual(routeAllocation(48000, 'desktop'), { R: 1500, stackMax: 3, dust: 48000 - 1500 - 7720 * 3 });
  assert.deepEqual(routeAllocation(14000, 'mobile'), { R: 1500, stackMax: 1, dust: 4780 });
  assert.deepEqual(routeAllocation(10000, 'saver'), { R: 1200, stackMax: 1, dust: 1080 });
});
test('route never crosses the map edge', () => { const r = routeLegs(1500); for (let i = 3; i < r.length; i += 3) assert.ok(Math.abs(r[i] - r[i - 3]) < 0.5); });
test('Pacific leg peaks near 53°N', () => { const pts = greatCircle({ lat: 37.57, lon: 126.98 }, { lat: 33.75, lon: -117.83 }, 400); assert.ok(Math.abs(Math.max(...pts.map((p) => p.lat)) - 53.3) < 0.5); });
test('legs take equal thirds', () => { const r = routeLegs(1500); assert.ok(Math.abs(r[2]) < 1e-6); assert.ok(Math.abs(r[r.length - 1] - 1) < 1e-6); });
test('meta classes', () => {
  const f = buildWorldMap(14000, { tierName: 'mobile', rng: mulberry32(5) }); let land = 0, route = 0, dust = 0;
  for (let i = 0; i < 14000; i++) { const m = f.data[i * 4 + 3]; m === 0 ? land++ : m >= 1 ? route++ : dust++; }
  assert.deepEqual([land, route, dust], [7720, 1500, 4780]);
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
test('timeline', () => {
  assert.deepEqual(routeTimeline(0), { night: 0, route: 0, card: 0, reticle: false });
  assert.deepEqual(routeTimeline(0.08), { night: 1, route: 0, card: 0, reticle: false });
  const mid = routeTimeline(0.44); near(mid.route, 0.5); assert.equal(mid.card, 1); assert.equal(mid.reticle, false);
  assert.deepEqual(routeTimeline(0.8), { night: 1, route: 1, card: 3, reticle: true }); // route clamped to exactly 1
  near(routeTimeline(0.96).night, 0.5);
  assert.equal(routeTimeline(1).night, 0);
});

// Beyond the brief: how the route and the land dots are laid out.
import { routeAlpha, MAP_BOX } from '../js/engine/formations/worldmap.js';
import { WORLDMAP } from '../js/data/worldmap-dots.js';
import { decodeRuns } from '../js/engine/geo.js';

/** Length on the map (world units) of each leg's particles, and how many particles each leg has. */
function legStats(r) {
  const stats = [0, 1, 2].map(() => ({ n: 0, length: 0 }));
  for (let i = 0; i < r.length; i += 3) {
    const leg = Math.min(2, Math.floor(r[i + 2] * 3 + 1e-6));
    const s = stats[leg];
    if (s.n > 0) s.length += Math.hypot((r[i] - r[i - 3]) * MAP_BOX.w, (r[i + 1] - r[i - 2]) * MAP_BOX.h);
    s.n++;
  }
  return stats;
}

test('the legs share the route particles by their length on the map, so the drawn line is evenly dense', () => {
  const stats = legStats(routeLegs(1500));
  assert.equal(stats.reduce((sum, s) => sum + s.n, 0), 1500);
  const density = stats.map((s) => s.n / s.length);
  for (const d of density) assert.ok(Math.abs(d / density[2] - 1) < 0.05, density.join(', '));
});

test('route alpha: the points overlapping on the line add up to the same strength at every tier', () => {
  const length = legStats(routeLegs(1500)).reduce((sum, s) => sum + s.length, 0);
  // [R, point diameter (uSize · uSizeScale)] of desktop, laptop, mobile and saver
  const strength = [[1500, 0.02], [1500, 0.0262], [1500, 0.037], [1200, 0.04]]
    .map(([R, d]) => routeAlpha(R, d) * (R / length) * d);   // alpha × points covering one spot
  for (const s of strength) assert.ok(Math.abs(s / strength[0] - 1) < 1e-9 && s > 1 && s < 2, strength.join(', '));
  assert.equal(routeAlpha(10, 0.02), 1);   // a sparse route is not boosted past full alpha
});

test('stacked land dots stay inside their lattice cell (the reticle squares whole cells)', () => {
  const f = buildWorldMap(48000, { tierName: 'desktop', rng: mulberry32(9) });
  const perCell = new Map();
  for (let i = 0; i < 48000; i++) {
    if (f.data[i * 4 + 3] !== 0) continue;
    const col = Math.floor((f.data[i * 4] / f.box.w + 0.5) * WORLDMAP.cols);
    const row = Math.floor((0.5 - f.data[i * 4 + 1] / f.box.h) * WORLDMAP.rows);
    perCell.set(`${col},${row}`, (perCell.get(`${col},${row}`) ?? 0) + 1);
  }
  const dots = decodeRuns(WORLDMAP);
  assert.equal(perCell.size, dots.length / 2);
  for (let d = 0; d < dots.length; d += 2) assert.equal(perCell.get(`${dots[d]},${dots[d + 1]}`), 3);
  assert.deepEqual(f.box, { ...MAP_BOX });
});

test('a tier too small for the map is refused', () => {
  assert.throws(() => buildWorldMap(9000, { tierName: 'mobile', rng: mulberry32(1) }), RangeError);
});

// Ruling R59: the night chrome flips with hysteresis, so a fast flick through the Route never flips it.
import { groundState, readoutAt } from '../js/sections/route.js';
test('the night ground attribute turns on at uNight ≥ 0.7 and off at ≤ 0.3, and holds in between', () => {
  assert.equal(groundState(false, 0.69), false);
  assert.equal(groundState(false, 0.7), true);
  assert.equal(groundState(true, 0.31), true);
  assert.equal(groundState(true, 0.3), false);
  assert.equal(groundState(false, 0.5), false);
  assert.equal(groundState(true, 0.5), true);
  assert.equal(groundState(true, 1), true);
  assert.equal(groundState(false, 0), false);
});
test('the reticle readout sits right of and below the pointer, flipped left near the right edge and above near the bottom', () => {
  const chip = { w: 140, h: 24 };
  const view = { w: 1440, h: 900 };
  const place = (x, y) => readoutAt(x, y, chip.w, chip.h, view.w, view.h);
  assert.deepEqual(place(400, 300), { x: 418, y: 318 });
  assert.deepEqual(place(1300, 300), { x: 1300 - 18 - 140, y: 318 });
  assert.deepEqual(place(400, 870), { x: 418, y: 870 - 18 - 24 });
  assert.deepEqual(place(1300, 870), { x: 1142, y: 828 });
  assert.deepEqual(place(400, 900 - 18 - 24), { x: 418, y: 900 - 24 });   // just fits below
});

// Spec §3.3: under reduced motion uNight is not scrubbed; a 300 ms time fade runs at the stage's edges.
import { nightStep } from '../js/sections/route.js';
import { mapFit } from '../js/ui/fallback-map.js';
test('reduced motion: uNight fades to 1 over 300 ms once inside the stage, back to 0 at its edges', () => {
  let n = 0;
  for (let i = 0; i < 3; i++) n = nightStep(n, 0.01, true, 0.1);
  near(n, 1);
  near(nightStep(0, 0.5, true, 0.1), 1 / 3);
  assert.equal(nightStep(0, 0, true, 0.1), 0, 'p = 0: the stage has not started');
  near(nightStep(1, 1, true, 0.1), 2 / 3);
  assert.equal(nightStep(1, 0.96, true, 0.1), 1, 'no scrubbed fade-out inside the stage');
});
test('full motion: uNight follows the timeline at no more than 2.5 units/s', () => {
  near(nightStep(0, 0.04, false, 0.1), 0.25);
  near(nightStep(0, 0.02, false, 1 / 60), 2.5 / 60);
  near(nightStep(0, 0.02, false, 0.2), 0.25);
  near(nightStep(1, 0.96, false, 0.01), 0.975);
});

// Spec §8.3: the 2D fallback map's lattice fitted (contain) into a region, centred, optionally on a focus box.
// main.js imports it (js/ui/fallback-map.js) only when the page needs it: the Route's modules failing to load cost the
// map, never main.js (final review M5).
import { readFileSync } from 'node:fs';
test('main.js reaches the Route\'s modules only through import(), never statically', () => {
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const statics = [...main.matchAll(/^import\b[^;]*?from '([^']+)';/gms)].map((m) => m[1]);
  assert.ok(statics.length > 5, statics.join(', '));
  assert.ok(!statics.some((p) => /sections\/route\.js|fallback-map\.js/.test(p)), statics.join(', '));
  assert.match(main, /import\('\.\/ui\/fallback-map\.js'\)/);
});
test('the fallback map fits the whole lattice into the region, centred', () => {
  assert.deepEqual(mapFit({ x: 0, y: 0, w: 1300, h: 480 }), { x: 0, y: 0, cell: 5 });
  const phone = mapFit({ x: 0, y: 0, w: 390, h: 844 });
  near(phone.cell, 1.5);
  near(phone.x, 0);
  near(phone.y, (844 - 96 * 1.5) / 2);
});
test('the fallback map can frame a focus box of the lattice into the region', () => {
  const fit = mapFit({ x: 10, y: 100, w: 400, h: 200 }, { x: 90, y: 20, w: 40, h: 10 });
  near(fit.cell, 10);                  // the focus's width binds: 400 / 40
  near(fit.x + 90 * fit.cell, 10);     // the focus starts at the region's left
  near(fit.y + 20 * fit.cell, 100 + (200 - 10 * 10) / 2);
});
