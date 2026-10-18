import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetric, formatMetric } from '../js/ui/split.js';
test('euro with grouping', () => {
  const p = parseMetric('€1,583');
  assert.deepEqual(p, { prefix: '€', value: 1583, decimals: 0, suffix: '', grouping: true });
  assert.equal(formatMetric(p, 1234.4), '€1,234');
});
test('keeps decimals', () => { const p = parseMetric('0.90'); assert.equal(p.decimals, 2); assert.equal(formatMetric(p, 0.4567), '0.46'); });
test('prefix and suffix', () => {
  assert.deepEqual(parseMetric('$6.64M'), { prefix: '$', value: 6.64, decimals: 2, suffix: 'M', grouping: false });
  assert.equal(formatMetric(parseMetric('+25%'), 12.2), '+12%');
  assert.equal(formatMetric(parseMetric('34.5'), 34.5), '34.5');
});
test('text without a single number is not a metric', () => {
  assert.equal(parseMetric('Google Trends forecasts'), null);
  assert.equal(parseMetric('lr 3e-3'), null);
});

// Task 19: a split element holds its text twice (the aria-hidden units and the .sr-only copy), so select-all + copy
// gave every heading and the bio twice. The screen-reader copy is left out of selections.
import { readFileSync } from 'node:fs';
test('the screen-reader copy of split text cannot be selected (copying gives the text once)', () => {
  const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
  const rule = css.match(/\.is-split > \.sr-only\s*\{([^}]*)\}/);
  assert.ok(rule, 'an .is-split > .sr-only rule');
  assert.match(rule[1], /user-select: none;/);
});
