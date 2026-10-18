import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMetric, formatMetric, wordMargins } from '../js/ui/split.js';
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
test('the screen-reader copy of split text cannot be selected (copying gives the text once)', () => {
  const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
  const rule = css.match(/\.is-split > \.sr-only\s*\{([^}]*)\}/);
  assert.ok(rule, 'an .is-split > .sr-only rule');
  assert.match(rule[1], /user-select: none;/);
});

// Task 6 deferred minor (Task 19 triage): words split into inline-blocks lose the kerning across their edges (with
// the spaces), so a split paragraph ran up to ~3.4 px wider than its plain text and wrapped a word earlier at
// some widths (the About bio took a seventh line at 1024 px). Each word gets back the advance it has in the plain
// text as a margin-right: the plain text's word-to-word distance less the split one's (unwrapped probes).
test('word margins give each split word its advance in the plain text', () => {
  // Word starts in px: plain text vs. the split copy (each split word starts a little later).
  const plain = [0, 41.2, 70.9, 120.05];
  const split = [0, 41.3, 71.15, 120.4];
  const m = wordMargins(plain, split);
  assert.equal(m.length, 4);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  close(m[0], -0.1);
  close(m[1], -0.15);
  close(m[2], -0.1);
  assert.equal(m[3], 0, 'the last word has no next word to meet');
  // With them, every split word starts where its plain twin does.
  let x = 0;
  const starts = split.map((s, i) => (i === 0 ? s : (x += (split[i] - split[i - 1]) + m[i - 1])));
  starts.forEach((s, i) => close(s, plain[i]));
  // Differences under 0.01 px are left alone (no style written), and a single word needs none.
  assert.deepEqual(wordMargins([0, 10, 20], [0, 10.004, 19.999]), [0, 0, 0]);
  assert.deepEqual(wordMargins([0], [0]), [0]);
});
