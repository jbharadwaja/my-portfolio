import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCommand, complete, levenshtein, projectLine, lossCurve, createConsole } from '../js/ui/console.js';
import { WHOAMI } from '../js/content.js';
import { ringFactor, isDrag, magnetPull, watchesReticle } from '../js/ui/cursor.js';
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
  assert.deepEqual(runCommand('contact', full).links, ['mailto:bharadwajajulian@gmail.com', 'https://github.com/jbharadwaja']);
  for (const name of ['help', 'whoami', 'skills', 'journey', 'resume']) assert.equal(runCommand(name, full).links, undefined, name);
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

// ---------------------------------------------------------------- the dialog, on a small fake DOM

/** Just enough of an element for createConsole: a tree, class names, focus, listeners, a scroll box. */
class FakeElement {
  constructor(doc, tag, className = '') {
    Object.assign(this, { ownerDocument: doc, tagName: tag.toUpperCase(), className, parentNode: null, children: [] });
    Object.assign(this, { hidden: false, value: '', textContent: '', attributes: {}, listeners: {} });
    Object.assign(this, { scrollTop: 0, scrollHeight: 0, clientHeight: 0, isContentEditable: false, isConnected: true });
  }
  get classList() {
    const names = () => this.className.split(' ').filter(Boolean);
    return {
      contains: (name) => names().includes(name),
      add: (name) => { if (!names().includes(name)) this.className = [...names(), name].join(' '); },
      remove: (name) => { this.className = names().filter((n) => n !== name).join(' '); },
    };
  }
  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof FakeElement)) continue;   // text: the tests read no output
      node.parentNode = this;
      this.children.push(node);
    }
  }
  before(node) {
    node.parentNode = this.parentNode;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, node);
  }
  replaceChildren() { this.children = []; }
  cloneNode() { return new FakeElement(this.ownerDocument, this.tagName, this.className); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  /** Only the selector lists the console uses: tag names ('input, textarea, select'). */
  closest(selector) {
    const tags = selector.split(',').map((s) => s.trim().toUpperCase());
    for (let n = this; n; n = n.parentNode) if (tags.includes(n.tagName)) return n;
    return null;
  }
  /** Only class selectors ('.console-log'). */
  querySelector(selector) {
    for (const child of this.children) {
      if (child.classList.contains(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  scrollBy({ top = 0 }) { this.scrollTop += top; }
  setSelectionRange() {}
}

/**
 * A page with the console dialog (#console: .console-log, .console-input) closed, and focus on <body>. `cards` are
 * the rail's cards (#work .card); `scroll.jumpTo` records its targets in `jumps`.
 */
function consolePage({ cards = [], contact = [] } = {}) {
  globalThis.matchMedia ??= () => ({ matches: false });
  const doc = {
    listeners: {},
    selection: { isCollapsed: true, anchorNode: null, focusNode: null },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    createElement(tag) { return new FakeElement(this, tag); },
    querySelector: (selector) => (selector === '.site-header' ? { offsetHeight: 64 } : null),
    querySelectorAll: (selector) => (selector === '#work .card' ? cards : []),
    getSelection() { return this.selection; },
  };
  doc.documentElement = new FakeElement(doc, 'html');
  doc.body = new FakeElement(doc, 'body');
  doc.documentElement.append(doc.body);
  doc.activeElement = doc.body;
  const root = new FakeElement(doc, 'div', 'console');
  root.hidden = true;
  const log = new FakeElement(doc, 'div', 'console-log');
  log.clientHeight = 400;
  const input = new FakeElement(doc, 'input', 'console-input');
  root.append(log, input);
  doc.body.append(root);
  const jumps = [];
  const scroll = { lock() {}, unlock() {}, jumpTo: (target) => { jumps.push(target); return Promise.resolve(); } };
  const ctx = { cards: cards.map(() => card), skills: [], journey: [], contact };
  const api = createConsole({ root, scroll, ctx });
  /** A keydown on `target` (the focused element by default), bubbling up to the document: whether it was prevented. */
  const press = (key, { target = doc.activeElement, ...mods } = {}) => {
    let prevented = false;
    const e = {
      key, target, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
      preventDefault: () => { prevented = true; },
    };
    for (let n = target; n; n = n.parentNode) for (const fn of n.listeners.keydown ?? []) fn(e);
    for (const fn of doc.listeners.keydown ?? []) fn(e);
    return prevented;
  };
  return { doc, root, log, input, api, press, jumps };
}

test('Esc on a console opened from the page leaves focus off its hidden input, so ~ at once reopens it', () => {
  const { doc, root, input, press } = consolePage();
  press('~');
  assert.equal(root.hidden, false);
  assert.equal(doc.activeElement, input);
  press('Escape');
  assert.equal(root.hidden, true);
  assert.notEqual(doc.activeElement, input, 'focus is not left on the hidden input');
  press('~');                          // the same frame: no focus fixup by the browser in between
  assert.equal(root.hidden, false, '~ reopens it');
});

test('keys pressed outside the input go to it, but not Ctrl/Meta combos, bare modifiers or keys over a log selection', () => {
  const { doc, log, input, api, press } = consolePage();
  api.open();
  const strayed = () => doc.body.focus();   // a click on the log text: focus on <body>
  for (const [key, mods] of [['c', { metaKey: true }], ['c', { ctrlKey: true }], ['Meta'], ['Control'], ['Shift'], ['Alt']]) {
    strayed();
    press(key, mods);
    assert.equal(doc.activeElement, doc.body, `${key} ${JSON.stringify(mods ?? {})} keeps focus (and the selection) where it is`);
  }
  strayed();
  const line = log.children[0];
  doc.selection = { isCollapsed: false, anchorNode: line, focusNode: line };
  press('c');
  assert.equal(doc.activeElement, doc.body, 'a key over a selection in the log leaves it alone');
  doc.selection = { isCollapsed: true, anchorNode: line, focusNode: line };
  press('c');
  assert.equal(doc.activeElement, input, 'a key with nothing selected goes to the input');
});

test('PageUp and PageDown scroll the log by most of its height', () => {
  const { log, api, press } = consolePage();
  api.open();
  log.scrollTop = 1000;
  assert.equal(press('PageUp'), true);
  assert.ok(log.scrollTop < 1000 && log.scrollTop >= 1000 - 400, `PageUp: ${log.scrollTop}`);
  const up = log.scrollTop;
  assert.equal(press('PageDown'), true);
  assert.equal(log.scrollTop, 1000, `PageDown: ${log.scrollTop}`);
  assert.ok(1000 - up > 0.5 * 400);
});

// The cursor's frame loop keeps running for a resting pointer only while route.js draws the reticle there.
test('the cursor watches a stage only while its reticle is on, not every stage with a readout', () => {
  // The readout inside a stage with these classes; closest() handles compound class selectors ('.stage.reticle-on').
  const readoutIn = (stageClasses) => {
    const stage = { classList: new Set(stageClasses.split(' ')), parentNode: null };
    const node = { classList: new Set(['reticle-readout']), parentNode: stage };
    node.closest = (selector) => {
      const want = selector.split('.').filter(Boolean);
      for (let n = node; n; n = n.parentNode) if (want.every((c) => n.classList.has(c))) return n;
      return null;
    };
    return node;
  };
  assert.equal(watchesReticle(readoutIn('stage')), false, 'the Route stage, its readout in place, the reticle off');
  assert.equal(watchesReticle(readoutIn('stage reticle-on')), true);
  assert.equal(watchesReticle(null), false);
});

// Ruling R65: the console is wired before the CDN settles, so the veil can still be up; ~ does nothing under it.
test('~ does not open the console while the loading veil is up (html.js without .veil-done)', () => {
  const { doc, root, press } = consolePage();
  doc.documentElement.classList.add('js');
  assert.equal(press('~'), false, 'not prevented: nothing handled it');
  assert.equal(root.hidden, true);
  doc.documentElement.classList.add('veil-done');
  press('~');
  assert.equal(root.hidden, false, 'opens once the veil has lifted');
});

// Task 26 review (R69): focus must leave the hidden input even when the element it returns to does not take it.
test('Esc leaves focus off the hidden input even when the element it returns to refuses focus', () => {
  const { doc, root, input, press } = consolePage();
  const button = new FakeElement(doc, 'button');
  doc.body.append(button);
  button.focus();
  button.focus = () => {};             // hidden or inert by the time the console closes: it does not take focus
  press('~');
  assert.equal(doc.activeElement, input);
  press('Escape');
  assert.equal(root.hidden, true);
  assert.notEqual(doc.activeElement, input, 'not left on the hidden input');
  press('~');
  assert.equal(root.hidden, false, '~ reopens it at once');
});

// R69: the rail's geometry is imported only when `open <n>` runs (a section module failing to load would otherwise
// take main.js down), and the jump still goes to railPositionFor(card), then focuses the card.
test('open <n> imports the rail geometry lazily, jumps to the card\'s rail place, then focuses the card', async (t) => {
  const src = readFileSync(new URL('../js/ui/console.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\b[^;]*from\s*'\.\.\/sections\//m, 'no static import of a section module');
  const saved = ['document', 'window'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  t.after(() => {
    for (const [k, d] of saved) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k];
  });
  const page = consolePage({ cards: [0, 1, 2].map((i) => ({ i, getBoundingClientRect: () => ({ top: 400 + 100 * i }) })) });
  // Without the live rail (no scroll libraries in Node), railPositionFor is the card's place under the header.
  globalThis.document = page.doc;
  globalThis.window = { scrollY: 120 };
  let focused = null;
  page.doc.querySelectorAll('#work .card')[1].focus = function () { focused = this; };
  page.api.open();
  page.input.value = 'open 2';
  page.press('Enter');
  assert.equal(page.root.hidden, true, 'the console closes first');
  for (let i = 0; i < 5 && !focused; i++) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(page.jumps, [500 + 120 - 64]);
  assert.equal(focused?.i, 1, 'the card has focus once the page is there');
});

// Wave-2 deferred minor (Task 19 triage): only contact's lines are links. A line of another command that happens to
// read like a contact link (here whoami's, set as one) prints as text, not as that link.
test('only the contact command prints links; the same text from another command stays text', () => {
  const contact = [{ text: WHOAMI, href: 'mailto:someone@example.com' }];
  const { log, input, api, press } = consolePage({ contact });
  api.open();
  const submit = (line) => {
    input.value = line;
    press('Enter', { target: input });
    return log.children.at(-1);
  };
  const plain = submit('whoami');
  assert.equal(plain.textContent, WHOAMI);
  assert.equal(plain.children.length, 0, 'no link');
  const linked = submit('contact');
  assert.equal(linked.children[0]?.tagName, 'A');
  assert.equal(linked.children[0].href, 'mailto:someone@example.com');
  assert.equal(linked.children[0].textContent, WHOAMI);
});
