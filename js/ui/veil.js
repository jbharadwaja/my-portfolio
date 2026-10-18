// Loading veil: the denoising meter (spec 6.1).
// Imports nothing from the CDN, so the meter runs while the libraries download. The maths is pure and
// Node-testable; the DOM driver starts only when a document exists. The inline boot script (index.html,
// js/boot-inline.js) owns window.__veil — lift(), banner(url), lifted — and the 8 s cap.

export const WEIGHTS = { fonts: 0.15, three: 0.4 / 3, gsap: 0.4 / 3, lenis: 0.4 / 3, portrait: 0.20, compile: 0.20, formations: 0.05 };

const CELLS = 32;
const STEPS = 50;
const FINISH_MS = 240;           // the meter's run to full once the page says it is ready
const TEXT_MS = 400;             // show the veil text after this long even if Geist Mono is not in
const FONTS = ['800 1em Archivo', '900 1em Archivo', '400 11px "Geist Mono"'];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Displayed progress: real progress, or a soft creep toward 0.9 while nothing reports; never decreases. */
export function displayedProgress(real, tSec, prev) {
  return clamp01(Math.max(real, 0.9 * (1 - Math.exp(-tSec / 2.5)), prev));
}

/** Lit meter cells, 0..32. */
export function cellsLit(p) {
  return Math.floor(clamp01(p) * CELLS);
}

export function stepLabel(p) {
  return `denoising step ${String(Math.round(clamp01(p) * STEPS)).padStart(2, '0')} / ${STEPS}`;
}

/** Weighted progress over the keys still in `weights`; dropping a key re-weights the rest to sum to 1. */
export function realProgress(fractions, weights) {
  let sum = 0;
  let total = 0;
  for (const key in weights) {
    total += weights[key];
    sum += weights[key] * (fractions[key] ?? 0);
  }
  return total > 0 ? sum / total : 1;
}

const fractions = {};
const weights = { ...WEIGHTS };
const liftCallbacks = [];
const bootApi = () => globalThis.__veil;
const isLifted = () => Boolean(bootApi()?.lifted);

let ui = null;                   // { el, cells, label } once the DOM driver has started
let t0 = 0;
let displayed = 0;
let lit = 0;
let shown = stepLabel(0);
let raf = 0;
let finish = null;               // { from, t0 } while the meter runs to full
let ready = null;

function onLift(cb) {
  if (isLifted()) Promise.resolve().then(cb);
  else liftCallbacks.push(cb);
}

const FONT_SHEETS = 'link[rel="stylesheet"][href^="https://fonts.googleapis.com/"]';
let declared = null;

/**
 * Resolves once the Google Fonts stylesheets apply: they load without blocking the page (Ruling R26: media="print"
 * until their onload flips them to all), so until then their @font-face rules do not exist and document.fonts.load()
 * resolves at once with nothing loaded. Also resolves when they fail, or when the veil lifts (a stalled stylesheet
 * leaves the page on its fallback faces; late fonts still fire `loadingdone`). Never rejects.
 */
export function fontFacesDeclared() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return Promise.resolve();
  declared ??= new Promise((resolve) => {
    const pending = [...document.querySelectorAll(FONT_SHEETS)].filter((link) => !link.sheet);
    let left = pending.length;
    // The onload attribute flipped the media first (it was registered at parse time); the style flush registers the
    // faces before anyone asks for them.
    const applied = () => {
      void getComputedStyle(document.documentElement).fontFamily;
      resolve();
    };
    const settled = () => {
      if (--left === 0) applied();
    };
    if (left === 0) {
      applied();
      return;
    }
    for (const link of pending) {
      link.addEventListener('load', settled, { once: true });
      link.addEventListener('error', settled, { once: true });
    }
    onLift(resolve);
  });
  return declared;
}

export const veil = {
  /** A stage reports its fraction (default: done). Keys outside WEIGHTS are ignored. */
  report(key, fraction = 1) {
    if (key in weights) fractions[key] = clamp01(fraction);
  },
  /** A stage will never report (e.g. `compile` without WebGL): the remaining weights are re-normalised. */
  dropKey(key) {
    delete weights[key];
  },
  /** The page is ready: run the meter to full, then lift. Resolves on the frame the fade begins, or at once if the veil is already up and gone. */
  liftWhenReady() {
    ready ??= new Promise((resolve) => {
      onLift(resolve);
      if (isLifted()) return;
      if (!ui) {
        bootApi()?.lift();
        resolve();
        return;
      }
      finish = { from: displayed, t0: null };
      if (!raf) raf = requestAnimationFrame(frame);
    });
    return ready;
  },
  /** cb runs once the veil is lifted, by any route: the meter, the 8 s cap, or an asset error. */
  onLift,
};

function paint(p) {
  for (const n = cellsLit(p); lit < n; lit++) ui.cells[lit].classList.add('on');
  const text = stepLabel(p);
  if (text !== shown) ui.label.textContent = shown = text;
}

function frame(now) {
  raf = 0;
  if (isLifted()) return;
  if (finish) {
    finish.t0 ??= now;
    const k = clamp01((now - finish.t0) / FINISH_MS);
    displayed = Math.max(displayed, k >= 1 ? 1 : finish.from + (1 - finish.from) * (1 - (1 - k) ** 3));
    paint(displayed);
    if (k >= 1) {
      bootApi().lift();          // adds .veil-done: the 600 ms fade starts; veil:lift runs onLifted()
      return;
    }
  } else {
    displayed = displayedProgress(realProgress(fractions, weights), (now - t0) / 1000, displayed);
    paint(displayed);
  }
  raf = requestAnimationFrame(frame);
}

function onLifted() {
  cancelAnimationFrame(raf);
  raf = 0;
  for (const cb of liftCallbacks.splice(0)) {
    try { cb(); } catch (err) { console.error(err); }
  }
}

function trackFonts() {
  const load = (spec) => (document.fonts ? document.fonts.load(spec) : Promise.resolve());
  const showText = () => ui.el.classList.add('veil-text');
  let done = 0;
  const tick = () => veil.report('fonts', ++done / FONTS.length);
  fontFacesDeclared().then(() => {
    const loads = FONTS.map(load);
    loads.forEach((p) => p.then(tick, tick));
    loads[FONTS.length - 1].then(showText, showText);   // Geist Mono gates the veil text
  });
  setTimeout(showText, TEXT_MS);
}

function start() {
  const el = document.querySelector('.veil');
  if (!el) return;
  ui = { el, cells: el.querySelectorAll('.veil-meter i'), label: el.querySelector('.veil-label') };
  t0 = performance.now();
  document.addEventListener('veil:lift', onLifted);
  if (isLifted()) {              // already lifted before this module ran (an asset error, a slow network)
    onLifted();
    return;
  }
  trackFonts();
  raf = requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') start();
