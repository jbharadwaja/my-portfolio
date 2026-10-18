import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railGeometry, stageScroll, cardIndexAt, clusterWorldX, chartSpec } from '../js/sections/experiments.js';
import { buildClusters } from '../js/engine/formations/clusters.js';
import { mulberry32 } from '../js/engine/formations/common.js';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
test('1440 geometry', () => { const g = railGeometry(1440); close(g.cardW, 460.8); close(g.gap, 28.8); close(g.pad, 489.6); close(g.travel, 3427.2); });
test('breakpoint edges', () => {
  close(railGeometry(1280).cardW, 409.6); close(railGeometry(1279).cardW, 511.6);
  close(railGeometry(1024).cardW, 409.6); close(railGeometry(1023).cardW, 572.88);
  close(railGeometry(768).cardW, 430.08); close(railGeometry(767).cardW, 644.28);
  close(railGeometry(390).gap, 16);
});
test('rail scroll is 0.65 of travel', () => close(stageScroll(1000), 650));
test('card under the centre', () => assert.deepEqual([0, 0.5, 1].map(cardIndexAt), [0, 4, 7]));
test('cluster x follows the card', () => { close(clusterWorldX(720, 0, 1440, 5), 0); close(clusterWorldX(1440, 0, 1440, 5), 5); close(clusterWorldX(1440, -720, 1440, 5), 0); });
test('eight equal clusters', () => {
  const N = 10000, f = buildClusters(N, { rng: mulberry32(4) }); const c = Array(8).fill(0);
  for (let i = 0; i < N; i++) { const m = f.data[i * 4 + 3]; if (m >= 0) c[m]++; }
  assert.deepEqual(c, Array(8).fill(1100));
});

// Ruling R37: what each card's chart draws, from its data-* attributes.
test('two-bar chart: the model bar is the accent, both values print as written', () => {
  const up = chartSpec({ metric: '0.90', compare: '0.85', better: 'higher' });
  assert.equal(up.kind, 'pair');
  assert.deepEqual(up.rows.map((r) => [r.text, r.accent]), [['0.90', true], ['0.85', false]]);
  close(up.max, 0.9);
  assert.equal(up.limit, null);
  const down = chartSpec({ metric: '34.5', compare: '48', better: 'lower' });
  assert.deepEqual(down.rows.map((r) => [r.value, r.text]), [[34.5, '34.5'], [48, '48']]);
});
test('series chart: the chosen entry is the accent, values keep separators and decimals, the limit is carried', () => {
  const cars = chartSpec({ better: 'lower', seriesLabel: 'validation RMSE (€)', series: '[["mean baseline",4567],["XGBoost",1556],["LightGBM",1560,"chosen"]]' });
  assert.equal(cars.kind, 'series');
  assert.equal(cars.label, 'validation RMSE (€)');
  assert.deepEqual(cars.rows.map((r) => [r.label, r.text, r.accent]),
    [['mean baseline', '4,567', false], ['XGBoost', '1,556', false], ['LightGBM', '1,560', true]]);
  const wells = chartSpec({ better: 'lower', series: '[["Region 0",2.0],["Region 1",0.1,"chosen"],["Region 2",2.5]]', limit: '2.5' });
  assert.deepEqual(wells.rows.map((r) => r.text), ['2.0', '0.1', '2.5']);
  close(wells.limit, 2.5);
  close(wells.max, 2.5);
});
test('a card without chart data draws no chart', () => assert.equal(chartSpec({ better: undefined }), null));

// Ruling R59: one emphasis per chart (the accent), decimals as written, count-ups only for cards on screen.
import { shouldCount } from '../js/sections/experiments.js';
test('a chart has one emphasis: the accent row, and no "best" marking beside it', () => {
  const pair = chartSpec({ metric: '0.90', compare: '0.85', better: 'higher' });
  const series = chartSpec({ better: 'lower', series: '[["XGBoost",1556],["LightGBM",1560,"chosen"]]' });
  for (const spec of [pair, series]) assert.ok(spec.rows.every((r) => !('best' in r)), JSON.stringify(spec.rows));
  assert.deepEqual(series.rows.map((r) => r.accent), [false, true]);
});
test('series values keep the decimals written in data-series, trailing zeros included', () => {
  const all = chartSpec({ series: '[["Region 0",2.0],["Region 1",1.0,"chosen"],["Region 2",3.0]]' });
  assert.deepEqual(all.rows.map((r) => r.text), ['2.0', '1.0', '3.0']);
  assert.deepEqual(all.rows.map((r) => r.value), [2, 1, 3]);
  const mixed = chartSpec({ series: '[["a 10",12.50],["b",1,"chosen"]]' });   // digits inside a label are not a value
  assert.deepEqual(mixed.rows.map((r) => r.text), ['12.50', '1.00']);
});
test('a card counts up only while it is on screen: entered from the right, not yet gone off the left', () => {
  assert.equal(shouldCount({ left: 100, right: 560 }, 1440), true);
  assert.equal(shouldCount({ left: -300, right: 160 }, 1440), true);     // partly off the left, still seen
  assert.equal(shouldCount({ left: -460, right: 0 }, 1440), false);      // gone off the left
  assert.equal(shouldCount({ left: -900, right: -440 }, 1440), false);
  assert.equal(shouldCount({ left: 1224, right: 1684 }, 1440), false);   // not yet past 85% of the width
});
// Wave-2 deferred minor (Task 19 triage): a number written with an exponent is one value, and its decimals are the
// mantissa's less the exponent ("1.5e3" is 1500, no decimals; "2.5e-1" is 0.25, two), never "1.5" plus a stray "3".
test('series values written with an exponent keep the decimals they stand for', () => {
  const big = chartSpec({ series: '[["a",1.5e3],["b",2.25e3,"chosen"]]' });
  assert.deepEqual(big.rows.map((r) => r.text), ['1,500', '2,250']);
  const small = chartSpec({ series: '[["a",2.5e-1],["b",1E-2,"chosen"],["c",0.5]]' });
  assert.deepEqual(small.rows.map((r) => r.text), ['0.25', '0.01', '0.50']);
  const plus = chartSpec({ series: '[["a",1.25E+1],["b",3]]' });
  assert.deepEqual(plus.rows.map((r) => r.text), ['12.5', '3.0']);
});
