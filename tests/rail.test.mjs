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
test('two-bar chart: the model bar is the accent, data-better picks the better value', () => {
  const up = chartSpec({ metric: '0.90', compare: '0.85', better: 'higher' });
  assert.equal(up.kind, 'pair');
  assert.deepEqual(up.rows.map((r) => [r.text, r.accent, r.best]), [['0.90', true, true], ['0.85', false, false]]);
  close(up.max, 0.9);
  assert.equal(up.limit, null);
  const down = chartSpec({ metric: '34.5', compare: '48', better: 'lower' });
  assert.deepEqual(down.rows.map((r) => [r.value, r.best]), [[34.5, true], [48, false]]);
});
test('series chart: the chosen entry is the accent, values keep separators and decimals, the limit is carried', () => {
  const cars = chartSpec({ better: 'lower', seriesLabel: 'validation RMSE (€)', series: '[["mean baseline",4567],["XGBoost",1556],["LightGBM",1560,"chosen"]]' });
  assert.equal(cars.kind, 'series');
  assert.equal(cars.label, 'validation RMSE (€)');
  assert.deepEqual(cars.rows.map((r) => [r.label, r.text, r.accent, r.best]),
    [['mean baseline', '4,567', false, false], ['XGBoost', '1,556', false, true], ['LightGBM', '1,560', true, false]]);
  const wells = chartSpec({ better: 'lower', series: '[["Region 0",2.0],["Region 1",0.1,"chosen"],["Region 2",2.5]]', limit: '2.5' });
  assert.deepEqual(wells.rows.map((r) => r.text), ['2.0', '0.1', '2.5']);
  close(wells.limit, 2.5);
  close(wells.max, 2.5);
});
test('a card without chart data draws no chart', () => assert.equal(chartSpec({ better: undefined }), null));
