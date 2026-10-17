import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jumpMode, railScrollFor, currentSection } from '../js/ui/scroll.js';
test('adjacent jumps animate, far jumps cut', () => {
  assert.equal(jumpMode(0, 1), 'animate'); assert.equal(jumpMode(4, 3), 'animate');
  assert.equal(jumpMode(0, 2), 'cut'); assert.equal(jumpMode(6, 0), 'cut');
});
const geo = { stStart: 1000, stEnd: 3000, cardWidth: 400, innerWidth: 1000, railTravel: 2800 };
test('first card centred at the rail start', () => assert.equal(railScrollFor({ ...geo, cardLeft: 300 }), 1000));
test('last card centred at the rail end', () => assert.equal(railScrollFor({ ...geo, cardLeft: 300 + 2800 }), 3000));
test('clamped beyond the ends', () => assert.equal(railScrollFor({ ...geo, cardLeft: 9999 }), 3000));
test('current section by viewport centre', () => assert.equal(currentSection([0, 900, 2700, 5400], 3000), 2));

test('a jump within the same section animates', () => assert.equal(jumpMode(3, 3), 'animate'));
test('a section is current from the moment its top reaches the line', () => {
  const tops = [0, 900, 2700, 5400];
  assert.equal(currentSection(tops, 899.5), 0);
  assert.equal(currentSection(tops, 900), 1);
  assert.equal(currentSection(tops, 99999), 3);
  assert.equal(currentSection(tops, -50), 0);
});
test('clamped before the first card, and a rail with no travel stays at its start', () => {
  assert.equal(railScrollFor({ ...geo, cardLeft: -500 }), 1000);
  assert.equal(railScrollFor({ ...geo, cardLeft: 300, railTravel: 0 }), 1000);
});
test('scroll.js imports no library (it loads in Node, so nothing touches the DOM at load)', () => {
  const src = readFileSync(new URL('../js/ui/scroll.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\b/m);
});
