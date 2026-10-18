import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, complete, levenshtein, projectLine, lossCurve } from '../js/ui/console.js';
import { ringFactor, isDrag, magnetPull } from '../js/ui/cursor.js';
const card = { index: 'EXP_01', title: 'Movie review sentiment', metric: 'F1 0.90', verdict: 'BEAT TARGET' };
const ctx = { cards: Array(8).fill(card), skills: [], journey: [], contact: [] };
test('whoami', () => assert.deepEqual(runCommand('whoami', ctx).lines, ['julian bharadwaja — data scientist · ml engineer · data analyst — tustin, ca']));
test('open bounds', () => { assert.deepEqual(runCommand('open 9', ctx).lines, ['open: no experiment 9 (1–8)']); assert.deepEqual(runCommand('open 3', ctx).action, { type: 'jump-rail', index: 2 }); });
test('did you mean', () => { assert.deepEqual(runCommand('hepl', ctx).lines, ['command not found: hepl — did you mean help?']); assert.deepEqual(runCommand('xyzzy', ctx).lines, ['command not found: xyzzy — type help']); });
test('sudo', () => { const r = runCommand('sudo hire-me', ctx); assert.deepEqual(r.lines, ['[sudo] permission granted — opening mail…']); assert.deepEqual(r.action, { type: 'mailto', delayMs: 800 }); });
test('projects line', () => { assert.equal(runCommand('projects', ctx).lines.length, 8); assert.equal(runCommand('projects', ctx).lines[0], projectLine(1, card)); });
test('tab completion', () => { assert.equal(complete('j', ['journey', 'clear', 'contact']), 'journey'); assert.deepEqual(complete('c', ['journey', 'contact', 'clear']), ['clear', 'contact']); });
test('levenshtein', () => assert.equal(levenshtein('kitten', 'sitting'), 3));
test('cursor ring and drag threshold', () => { assert.ok(Math.abs(ringFactor(1 / 60) - 0.18) < 1e-9); assert.ok(Math.abs(ringFactor(1 / 30) - 0.3276) < 1e-9); assert.equal(isDrag(6), false); assert.equal(isDrag(6.1), true); });

// Ruling R6: the projects line, column by column.
test('projects line columns', () => {
  assert.equal(projectLine(1, card), '1  EXP_01  Movie review sentiment' + ' '.repeat(10) + ' F1 0.90' + ' '.repeat(9) + ' BEAT TARGET');
});

test('every other spec command answers', () => {
  const full = {
    ...ctx,
    skills: [{ name: 'Python', list: 'pandas, NumPy' }],
    journey: [{ when: '2012–2017 · Pathum Thani, Thailand', body: 'Asian Institute of Technology — B.E. Mechatronics Engineering.' }],
    contact: [{ text: 'bharadwajajulian@gmail.com', href: 'mailto:bharadwajajulian@gmail.com' }, { text: 'github.com/jbharadwaja', href: 'https://github.com/jbharadwaja' }],
    cv: { href: 'https://www.linkedin.com/in/julian-bharadwaja/', download: null },
  };
  const help = runCommand('help', full).lines;
  for (const name of ['help', 'whoami', 'projects', 'open <n>', 'skills', 'journey', 'contact', 'resume', 'train', 'clear', 'exit', 'sudo hire-me']) {
    assert.ok(help.some((line) => line.startsWith(`${name} `)), `help lists ${name}`);
  }
  assert.deepEqual(runCommand('skills', full).lines, ['Python       pandas, NumPy']);
  assert.deepEqual(runCommand('journey', full).lines, ['2012–2017 · Pathum Thani, Thailand — Asian Institute of Technology — B.E. Mechatronics Engineering.']);
  assert.deepEqual(runCommand('contact', full).lines, ['bharadwajajulian@gmail.com', 'github.com/jbharadwaja']);
  assert.deepEqual(runCommand('resume', full), { lines: ['resume: opening https://www.linkedin.com/in/julian-bharadwaja/ in a new tab'], action: { type: 'cv' } });
  assert.deepEqual(runCommand('resume', { ...full, cv: { href: 'assets/cv/Julian_Bharadwaja_Resume.pdf', download: '' } }).lines, ['resume: downloading Julian_Bharadwaja_Resume.pdf']);
  assert.deepEqual(runCommand('train', full).action, { type: 'train' });
  assert.deepEqual(runCommand('clear', full).action, { type: 'clear' });
  assert.deepEqual(runCommand('exit', full).action, { type: 'close' });
  assert.deepEqual(runCommand('  WhoAmI ', full).lines, runCommand('whoami', full).lines);
  assert.deepEqual(runCommand('', full), { lines: [] });
});

test('open takes a whole number in range', () => {
  assert.deepEqual(runCommand('open 1', ctx).action, { type: 'jump-rail', index: 0 });
  assert.deepEqual(runCommand('open 8', ctx).action, { type: 'jump-rail', index: 7 });
  for (const bad of ['0', 'x', '2.5', '-1']) {
    const r = runCommand(`open ${bad}`, ctx);
    assert.deepEqual(r.lines, [`open: no experiment ${bad} (1–8)`]);
    assert.equal(r.action, undefined);
  }
});

test('completion with no match lists nothing', () => assert.deepEqual(complete('z', ['help', 'clear']), []));

test('magnetic pull is at most 6 px, toward the pointer', () => {
  const [x, y] = magnetPull(1000, 1000, 40, 20);
  assert.ok(Math.hypot(x, y) <= 6 + 1e-9);
  assert.ok(x > 0 && y > 0);
  assert.deepEqual(magnetPull(0, 0, 40, 20), [0, 0]);
  const [sx] = magnetPull(-10, 0, 40, 20);
  assert.ok(sx < 0 && sx > -6, `a pointer inside the element pulls part way (${sx})`);
});

test('the train curve is ASCII only, drawn left to right', () => {
  const start = lossCurve(0);
  const end = lossCurve(1);
  assert.equal(start.length, end.length);
  for (const line of end) assert.match(line, /^[\x20-\x7e]*$/);
  const stars = (lines) => lines.join('').split('*').length - 1;
  assert.equal(stars(start), 0);
  assert.ok(stars(lossCurve(0.5)) > 0 && stars(lossCurve(0.5)) < stars(end));
});
