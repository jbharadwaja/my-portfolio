import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SECTIONS } from '../js/sections/index.js';

// Section scaffolding: one stylesheet and one module per section, loaded by a fixed list in main.js.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const main = read('../js/main.js');

const LOADED = ['encoder', 'training', 'experiments', 'route', 'about', 'signoff'];
const SHEETS = [...LOADED, 'ui'];

test('SECTIONS lists the six sections after the hero, in page order', () => {
  assert.deepEqual(SECTIONS, LOADED);
});

test('index.html links the seven section stylesheets right after css/main.css, in page order', () => {
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  const at = hrefs.indexOf('css/main.css');
  assert.ok(at >= 0, 'css/main.css is linked');
  assert.deepEqual(hrefs.slice(at + 1, at + 1 + SHEETS.length), SHEETS.map((s) => `css/sections/${s}.css`));
});

test('each section stylesheet exists and starts with a one-line header comment', () => {
  for (const s of SHEETS) {
    const path = `../css/sections/${s}.css`;
    assert.ok(existsSync(new URL(path, import.meta.url)), `${s}.css exists`);
    const first = read(path).split('\n')[0];
    assert.match(first, /^\/\* .+ \*\/$/, `${s}.css line 1 is a one-line comment`);
  }
});

test('the hero and every section module export init(ctx)', async () => {
  for (const name of ['hero', ...SECTIONS]) {
    const mod = await import(`../js/sections/${name}.js`);
    assert.equal(typeof mod.init, 'function', `${name}.init`);
  }
});

test('main.js hands SECTIONS to loadSections with its own importer, after the boundaries, before the reveals', () => {
  // loadSections' own behaviour (imports up front, inits in order, one try/catch each) is tested in sections.test.mjs.
  assert.match(main, /import \{ SECTIONS, loadSections \} from '\.\/sections\/index\.js';/);
  assert.doesNotMatch(main, /const SECTIONS\b/, 'the list is not redeclared in main.js');
  const steps = [
    'if (libs) {',
    'createBoundaryTriggers(ScrollTrigger);',
    'await loadSections(SECTIONS, (name) => import(`./sections/${name}.js`), ctx, console.error);',
    'initReveals(ctx)',
  ];
  let from = 0;
  for (const step of steps) {
    const at = main.indexOf(step, from);
    assert.ok(at >= 0, `"${step}" follows`);
    from = at;
  }
});
