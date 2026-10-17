import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDMAP, CITIES } from '../js/data/worldmap-dots.js';
import { decodeRuns, lonLatToCell, cellToLonLat, formatLatLon } from '../js/engine/geo.js';
test('lattice has 7,720 land dots', () => assert.equal(decodeRuns(WORLDMAP).length / 2, 7720));
test('every city sits on a land dot', () => {
  const dots = decodeRuns(WORLDMAP); const set = new Set();
  for (let i = 0; i < dots.length; i += 2) set.add(dots[i] + ',' + dots[i + 1]);
  for (const c of CITIES) assert.ok(set.has(c.col + ',' + c.row), c.id);
});
test('projection is Pacific-centred', () => {
  assert.deepEqual([lonLatToCell(100.61, 14.08, WORLDMAP).col, lonLatToCell(100.61, 14.08, WORLDMAP).row], [94, 43]);
  assert.equal(lonLatToCell(-117.83, 33.75, WORLDMAP).col, 196);
});
test('cell centre readout', () => {
  const { lat, lon } = cellToLonLat(196, 29, WORLDMAP);
  assert.equal(formatLatLon(lat, lon), '34.13°N 117.92°W');
});
