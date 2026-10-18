// The ~ console (spec §6.4): a keyboard-driven dialog. Its projects, skills, journey and contact output is read from
// the page's own DOM at boot, so it can never disagree with the page; `resume` follows the CV link as the DOM has it
// when the command runs. The parser, completion, the "did you mean" distance and the ASCII loss curve are pure and
// Node-testable; createConsole touches the DOM only when it is called.
import { railPositionFor } from '../sections/experiments.js';
import { HELP, WHOAMI, CONSOLE } from '../content.js';

const GUESS_MAX = 2;                   // "did you mean" only within this edit distance
const HELP_W = 14;                     // help's name column: 'sudo hire-me' and two spaces
const SKILL_W = 12;                    // skills' name column
const MAILTO_DELAY_MS = 800;
const TRAIN_MS = 2000;                 // the loss curve draws over ~2 s
const CURVE = { cols: 36, rows: 7 };
const PAGE = 0.875;                    // PageUp/PageDown move the log by this share of its height, as a browser pages
const MODIFIERS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'Meta', 'Shift']);

const ARG = / <[^>]+>$/;
/** The commands as typed: HELP's keys without their argument ('open <n>' → 'open'). */
const NAMES = Object.keys(HELP).map((key) => key.replace(ARG, ''));
const TAKES_ARG = new Set(Object.keys(HELP).filter((key) => ARG.test(key)).map((key) => key.replace(ARG, '')));

// ---------------------------------------------------------------- pure

/** Edit distance: insertions, deletions and substitutions each cost 1. */
export function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Tab completion: the one name starting with `prefix`, or every match in order (none: an empty list). */
export function complete(prefix, names) {
  const matches = names.filter((name) => name.startsWith(prefix)).sort();
  return matches.length === 1 ? matches[0] : matches;
}

/** One `projects` line: number, index, title, metric and verdict in columns. */
export function projectLine(n, card) {
  return `${n}  ${card.index}  ${card.title.padEnd(32)} ${card.metric.padEnd(16)} ${card.verdict}`;
}

/**
 * The `train` loss curve once a share `t` (0..1) of its epochs has run, as lines of ASCII: a falling exponential
 * with a little deterministic noise, one `*` per epoch column, between a 1.0–0.0 loss axis and the epoch axis.
 */
export function lossCurve(t, { cols = CURVE.cols, rows = CURVE.rows } = {}) {
  const drawn = Math.round(Math.min(1, Math.max(0, t)) * cols);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  for (let c = 0; c < drawn; c++) {
    const x = c / (cols - 1);
    const loss = 0.05 + 0.95 * Math.exp(-4 * x) + 0.03 * Math.sin(c * 2.3) * (1 - x);
    grid[Math.min(rows - 1, Math.max(0, Math.floor((1 - loss) * rows)))][c] = '*';
  }
  return [
    'loss',
    ...grid.map((cells, r) => `${r === 0 ? '1.0' : '   '} |${cells.join('')}`.trimEnd()),
    `0.0 +${'-'.repeat(cols)}`,
    `${' '.repeat(cols)}epoch`,
  ];
}

const fileName = (href) => href.split(/[?#]/)[0].split('/').pop();

function resume(cv) {
  if (!cv) return { lines: [CONSOLE.resumeMissing] };
  const line = cv.download === null ? CONSOLE.resumeOpen(cv.href) : CONSOLE.resumeDownload(cv.download || fileName(cv.href));
  return { lines: [line], action: { type: 'cv' } };
}

const COMMANDS = new Map([
  ['help', () => ({ lines: Object.entries(HELP).map(([name, about]) => `${name.padEnd(HELP_W)}${about}`) })],
  ['whoami', () => ({ lines: [WHOAMI] })],
  ['projects', ({ cards }) => ({ lines: cards.map((card, i) => projectLine(i + 1, card)) })],
  ['skills', ({ skills }) => ({ lines: skills.map(({ name, list }) => `${name.padEnd(SKILL_W)} ${list}`) })],
  ['journey', ({ journey }) => ({ lines: journey.map(({ when, body }) => `${when} — ${body}`) })],
  ['contact', ({ contact }) => ({ lines: contact.map(({ text }) => text) })],
  ['resume', ({ cv }) => resume(cv)],
  ['train', () => ({ lines: [], action: { type: 'train' } })],
  ['clear', () => ({ lines: [], action: { type: 'clear' } })],
  ['exit', () => ({ lines: [], action: { type: 'close' } })],
  ['sudo hire-me', () => ({ lines: [CONSOLE.sudo], action: { type: 'mailto', delayMs: MAILTO_DELAY_MS } })],
]);

function openCommand(arg, count) {
  if (arg === undefined) return { lines: [CONSOLE.openUsage(count)] };
  const n = /^\d+$/.test(arg) ? Number(arg) : NaN;
  if (!(n >= 1 && n <= count)) return { lines: [CONSOLE.noExperiment(arg, count)] };
  return { lines: [], action: { type: 'jump-rail', index: n - 1 } };
}

/** The closest command to what was typed, by its first word, when it is close enough to suggest. */
function guess(line) {
  const word = line.split(' ')[0];
  let best = null;
  let distance = Infinity;
  for (const name of NAMES) {
    const d = levenshtein(word, name.split(' ')[0]);
    if (d < distance) [best, distance] = [name, d];
  }
  return distance <= GUESS_MAX ? best : null;
}

/**
 * Runs one console line against `ctx` (readConsoleContext's shape): the lines to print and, for the commands that
 * do something, the action the console takes. Case and extra spaces do not matter.
 */
export function runCommand(input, ctx) {
  const typed = input.trim().replace(/\s+/g, ' ');
  const line = typed.toLowerCase();
  if (!line) return { lines: [] };
  const open = /^open(?: (.+))?$/i.exec(typed);
  if (open) return openCommand(open[1], ctx.cards.length);
  if (COMMANDS.has(line)) return COMMANDS.get(line)(ctx);
  const near = guess(line);
  return { lines: [near ? CONSOLE.notFound(typed, near) : CONSOLE.notFoundHelp(typed)] };
}

// ---------------------------------------------------------------- the DOM it reads

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** An element's text as the page reads it: a split or counting element's screen-reader copy, not its animated spans. */
function textOf(el) {
  const read = (node) => {
    if (node.nodeType === TEXT_NODE) return node.data;
    if (node.nodeType !== ELEMENT_NODE) return '';
    const copy = [...node.children].find((child) => child.classList.contains('sr-only'));
    return copy ? copy.textContent : [...node.childNodes].map(read).join('');
  };
  return el ? read(el).replace(/\s+/g, ' ').trim() : '';
}

/**
 * What the console prints, read from `doc`: the rail's cards (index, title, headline metric, verdict) in rail order,
 * the About skill groups, the Route stops and the sign-off's email, LinkedIn and GitHub links. `cv` is read each
 * time it is asked for — { href, download } of the page's CV link (download: the attribute, or null), or null.
 */
export function readConsoleContext(doc) {
  const all = (selector) => [...doc.querySelectorAll(selector)];
  return {
    cards: all('#work .card').map((card) => ({
      index: card.dataset.index,
      title: textOf(card.querySelector('.card-title')),
      metric: textOf(card.querySelector('.card-metric')),
      verdict: card.dataset.verdict,
    })),
    skills: all('#about .skill-group').map((group) => ({
      name: textOf(group.querySelector('.skill-name')),
      list: textOf(group.querySelector('.skill-list')),
    })),
    journey: all('#route .route-card').map((stop) => ({
      when: textOf(stop.querySelector('.route-when')),
      body: textOf(stop.querySelector('.route-body')),
    })),
    contact: all('#contact a[href]:not([data-cv])').map((a) => ({ text: textOf(a), href: a.getAttribute('href') })),
    get cv() {
      const link = doc.querySelector('a[data-cv]');
      return link && { href: link.getAttribute('href'), download: link.getAttribute('download') };
    },
  };
}

const isEditable = (el) => Boolean(el?.closest?.('input, textarea, select')) || Boolean(el?.isContentEditable);

// ---------------------------------------------------------------- the dialog

/**
 * Wires the console dialog `root` (its .console-log and .console-input) and the footer's .console-open button:
 * ` or ~ opens it (not while typing in a field or with another dialog open), Esc, `exit` or a click on the dimmed
 * page closes it. While open, the page scroll is locked through `scroll`, the custom cursor hides (html.console-shown)
 * and keys stay in the input: Tab completes, ↑/↓ walk the history, PageUp/PageDown scroll the log. A key pressed
 * elsewhere (focus strayed to the page: a click on the log) goes to the input, except a Ctrl/Meta shortcut, a bare
 * modifier or any key while log text is selected, so the selection can be copied. On close, focus returns where it
 * was, or leaves the hidden input.
 */
export function createConsole({ root, scroll, ctx }) {
  const doc = root.ownerDocument;
  const html = doc.documentElement;
  const log = root.querySelector('.console-log');
  const input = root.querySelector('.console-input');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const history = [];
  let at = 0;                          // the history entry shown; history.length is the line being typed
  let draft = '';                      // that line, kept while ↑/↓ show older ones
  let returnTo = null;
  let greeted = false;
  let training = null;                 // the running curve: finish() draws its last frame at once

  log.setAttribute('role', 'log');
  const prompt = doc.createElement('span');
  prompt.className = 'console-prompt';
  prompt.setAttribute('aria-hidden', 'true');
  prompt.textContent = CONSOLE.prompt;
  input.before(prompt);
  const isOpen = () => !root.hidden;
  const otherDialogOpen = () => [...doc.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .some((dialog) => dialog !== root && !dialog.hidden);
  const toEnd = () => { log.scrollTop = log.scrollHeight; };
  const selectingLog = () => {
    const selection = doc.getSelection();
    return Boolean(selection && !selection.isCollapsed
      && (log.contains(selection.anchorNode) || log.contains(selection.focusNode)));
  };
  // A key pressed with focus outside the console goes to its input, unless it is a Ctrl/Meta shortcut, a bare modifier
  // or the reader is selecting log text (to copy it).
  const takesStrayKey = (e) => !e.ctrlKey && !e.metaKey && !MODIFIERS.has(e.key) && !selectingLog();

  function line(className) {
    const row = doc.createElement('div');
    row.className = className ? `console-line ${className}` : 'console-line';
    log.append(row);
    return row;
  }

  // Contact output prints each link's text; it is shown as that link.
  function print(lines) {
    for (const text of lines) {
      const row = line();
      const link = ctx.contact.find((c) => c.text === text);
      if (!link) {
        row.textContent = text;
        continue;
      }
      const a = doc.createElement('a');
      a.href = link.href;
      a.textContent = text;
      if (/^https?:/.test(link.href)) Object.assign(a, { target: '_blank', rel: 'noopener' });
      row.append(a);
    }
    toEnd();
  }

  function echo(text) {
    line('console-echo').append(prompt.cloneNode(true), ` ${text}`);
  }

  function open() {
    if (isOpen()) return;
    returnTo = doc.activeElement;
    root.hidden = false;
    html.classList.add('console-shown');
    scroll.lock();
    if (!greeted) {
      greeted = true;
      print([CONSOLE.welcome]);
    }
    input.focus({ preventScroll: true });
    toEnd();
  }

  function close({ returnFocus = true } = {}) {
    if (!isOpen()) return;
    training?.finish();
    root.hidden = true;
    html.classList.remove('console-shown');
    scroll.unlock();
    const back = returnTo;
    returnTo = null;
    if (returnFocus && back && back !== doc.body && back.isConnected) back.focus({ preventScroll: true });
    // Otherwise off the hidden input now: left there until the browser's next focus fixup, it would swallow a ~.
    else if (root.contains(doc.activeElement)) doc.activeElement.blur();
  }

  function train() {
    const block = line('console-curve');
    block.setAttribute('aria-hidden', 'true');   // an ASCII picture, redrawn as it runs: nothing to announce
    let shown = '';
    const draw = (t) => {
      const text = lossCurve(t).join('\n');
      if (text === shown) return;
      block.textContent = shown = text;
      toEnd();
    };
    if (reduced.matches) {
      draw(1);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      training = null;
      draw(1);
    };
    const step = (now) => {
      if (now - start >= TRAIN_MS) return finish();
      draw((now - start) / TRAIN_MS);
      frame = requestAnimationFrame(step);
    };
    training = { finish };
    draw(0);
    frame = requestAnimationFrame(step);
  }

  // `open <n>`: close, then jump to that card's place on the rail; focus lands on it once the page is there. The
  // place is measured after the close, with the page's scrollbar back.
  function jumpToCard(index) {
    close({ returnFocus: false });
    const card = doc.querySelectorAll('#work .card')[index];
    if (card) scroll.jumpTo(railPositionFor(card)).then(() => card.focus({ preventScroll: true }));
  }

  function perform(action) {
    switch (action.type) {
      case 'clear': log.replaceChildren(); break;
      case 'close': close(); break;
      case 'jump-rail': jumpToCard(action.index); break;
      case 'cv': doc.querySelector('a[data-cv]')?.click(); break;   // its own target, rel and download (spec §6.2)
      case 'mailto': setTimeout(() => doc.querySelector('a[href^="mailto:"]')?.click(), action.delayMs); break;
      case 'train': train(); break;
      default: break;
    }
  }

  function submit() {
    const value = input.value;
    input.value = '';
    training?.finish();
    echo(value);
    const entry = value.trim();
    if (entry && entry !== history[history.length - 1]) history.push(entry);
    at = history.length;
    draft = '';
    const { lines, action } = runCommand(value, ctx);
    print(lines);
    if (action) perform(action);
  }

  function recall(step) {
    if (!history.length) return;
    if (at === history.length) draft = input.value;
    at = Math.min(history.length, Math.max(0, at + step));
    input.value = at === history.length ? draft : history[at];
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function tab() {
    const found = complete(input.value.trimStart().toLowerCase(), NAMES);
    if (typeof found === 'string') {
      input.value = TAKES_ARG.has(found) ? `${found} ` : found;
    } else if (found.length) {
      echo(input.value);
      print([found.join('  ')]);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') submit();
    else if (e.key === 'ArrowUp') recall(-1);
    else if (e.key === 'ArrowDown') recall(1);
    else if (e.key === 'Tab') {
      if (!e.shiftKey) tab();          // Shift+Tab does nothing: focus stays in the input
    } else return;
    e.preventDefault();
  });

  doc.addEventListener('keydown', (e) => {
    if (!isOpen()) {
      if ((e.key !== '`' && e.key !== '~') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isEditable(e.target) || otherDialogOpen()) return;
      e.preventDefault();              // the key opens the console; it is not typed into it
      open();
      return;
    }
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab' && e.target !== input) {
      e.preventDefault();              // never out of the console: back to the input
      input.focus({ preventScroll: true });
    } else if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      log.scrollBy({ top: (e.key === 'PageUp' ? -PAGE : PAGE) * log.clientHeight });
    } else if (!root.contains(e.target) && takesStrayKey(e)) {
      input.focus({ preventScroll: true });   // focus strayed (a click on the log text): the key goes to the input
    }
  });
  root.addEventListener('focusout', (e) => {
    if (isOpen() && e.relatedTarget && !root.contains(e.relatedTarget)) input.focus({ preventScroll: true });
  });
  // A click on the dimmed page around the panel closes it (not the end of a text selection dragged out of the log).
  let pressedOutside = false;
  root.addEventListener('pointerdown', (e) => { pressedOutside = e.target === root; });
  root.addEventListener('click', (e) => {
    if (e.target === root && pressedOutside) close();
  });
  doc.querySelector('.console-open')?.addEventListener('click', open);

  return { open, close };
}
