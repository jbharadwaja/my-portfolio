// Text reveals (spec §3.2–3.3): split text into words or letters that rise in, headline letters resolving from
// condensed to wide, with each word's width locked so lines never re-wrap mid-reveal; count-ups for numbers;
// and the hero name's measured fit. The metric maths is pure and Node-testable. This module imports no CDN
// library: initReveals/countUp receive gsap from main.js, and every DOM touch happens inside a function.
import { veil } from './veil.js';

// ---------------------------------------------------------------- metrics (pure)

const METRIC = /^(\D*?)(\d[\d,]*)(?:\.(\d+))?(\D*)$/;

/** '€1,583' -> { prefix: '€', value: 1583, decimals: 0, suffix: '', grouping: true }; null when there is no single number. */
export function parseMetric(str) {
  const m = METRIC.exec(String(str).trim());
  if (!m) return null;
  const [, prefix, int, frac = '', suffix] = m;
  return {
    prefix,
    value: Number(int.replace(/,/g, '') + (frac ? `.${frac}` : '')),
    decimals: frac.length,
    suffix,
    grouping: int.includes(','),
  };
}

const formatters = new Map();
function formatterFor(decimals, grouping) {
  const key = `${decimals}|${grouping}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    }));
  }
  return formatters.get(key);
}

/** Prints `value` in the shape `parts` was parsed from: the same prefix, decimals, separators and suffix. */
export function formatMetric({ prefix, decimals, suffix, grouping }, value) {
  return prefix + formatterFor(decimals, grouping).format(value) + suffix;
}

// ---------------------------------------------------------------- split

const originals = new WeakMap();   // split element -> its markup before the split

/**
 * Splits el's text into `.sw` word spans (and, in 'letters' mode, `.sc` letter spans inside each word). Nested
 * elements stay where they are, so the hero name keeps its two lines. The plain string stays in a `.sr-only`
 * copy for screen readers; the animated words are aria-hidden. Nothing is made invisible here (initReveals
 * does that), so a split that never animates still reads as the original text. Returns the animated units.
 */
export function splitText(el, mode) {
  unsplit(el);
  const letters = mode === 'letters';
  const plain = el.textContent.replace(/\s+/g, ' ').trim();
  originals.set(el, el.innerHTML);
  const units = [];

  const word = (text) => {
    const w = document.createElement('span');
    w.className = 'sw';
    w.setAttribute('aria-hidden', 'true');
    if (letters) {
      for (const ch of text) {
        const c = document.createElement('span');
        c.className = 'sc';
        c.textContent = ch;
        w.append(c);
        units.push(c);
      }
    } else {
      w.textContent = text;
      units.push(w);
    }
    return w;
  };
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) walk(child);
      else if (child.nodeType === 3) {
        child.replaceWith(...child.data.split(/(\s+)/).filter(Boolean).map((t) => (/^\s+$/.test(t) ? t : word(t))));
      }
    }
  };
  walk(el);

  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = plain;
  el.prepend(sr);
  el.classList.add('is-split');
  el.dataset.split = mode;
  return units;
}

/** Puts back the markup splitText replaced. */
export function unsplit(el) {
  const html = originals.get(el);
  if (html === undefined) return;
  el.innerHTML = html;
  el.classList.remove('is-split', 'split-wdth');
  delete el.dataset.split;
  originals.delete(el);
}

// ---------------------------------------------------------------- width lock

function probe(text, noKerning = false) {
  const p = document.createElement('span');
  p.className = 'split-probe';
  if (noKerning) p.style.fontKerning = 'none';
  p.textContent = text;
  return p;
}

/** Left edge of each character of a probe's text, plus its right edge: the advances letter by letter. */
function advances(p, chars) {
  const node = p.firstChild;
  const range = document.createRange();
  const lefts = [];
  let offset = 0;
  for (const ch of chars) {
    range.setStart(node, offset);
    range.setEnd(node, offset += ch.length);
    lefts.push(range.getBoundingClientRect().left);
  }
  const right = p.getBoundingClientRect().right;
  return lefts.map((x, i) => (i + 1 < lefts.length ? lefts[i + 1] : right) - x);
}

/**
 * Gives every `.sw` word of a letter-split element its final box: width and height measured on a hidden copy
 * at font-stretch 112%, so the letters can animate their width inside it without the line re-wrapping.
 * Separate inline-blocks lose the font's kerning, so each letter also takes a negative margin equal to the kern
 * the unsplit word had: at rest the word is exactly as wide as the plain text. Reads are batched before writes;
 * safe to run again on resize.
 */
export function lockWidths(el) {
  const jobs = [...el.querySelectorAll('.sw')].map((word) => {
    const letters = [...word.children];
    const kerned = probe(word.textContent);
    const flat = probe(word.textContent, true);
    word.after(kerned, flat);
    return { word, letters, kerned, flat };
  });
  const measured = jobs.map(({ letters, kerned, flat }) => {
    const box = kerned.getBoundingClientRect();
    const chars = letters.map((c) => c.textContent);
    const natural = advances(kerned, chars);
    const separate = advances(flat, chars);
    return { width: box.width, height: box.height, kerns: natural.map((a, i) => a - separate[i]) };
  });
  jobs.forEach(({ word, letters, kerned, flat }, i) => {
    const { width, height, kerns } = measured[i];
    kerned.remove();
    flat.remove();
    word.style.width = `${width}px`;
    word.style.height = `${height}px`;
    word.classList.add('sw--locked');
    letters.forEach((c, k) => { c.style.marginRight = Math.abs(kerns[k]) > 0.01 ? `${kerns[k]}px` : ''; });
  });
}

// ---------------------------------------------------------------- hero name fit

const fontsReady = () => (document.fonts
  ? Promise.all([document.fonts.load('800 1em Archivo', 'BHARADWAJA'), document.fonts.ready]).then(() => {}, () => {})
  : Promise.resolve());

/**
 * Sets --h1-fit on the hero name: the column width divided by the em-width of its widest line at weight 800 and
 * stretch 112% (BHARADWAJA, 8.22 em). The CSS takes min(7.5rem, --h1-fit).
 */
export function fitHeroName(h1) {
  const column = h1.parentElement.getBoundingClientRect().width;
  if (!column) return;
  const lines = [...h1.querySelectorAll('.line')];
  const probes = (lines.length ? lines : [h1]).map((line) => {
    const p = probe(line.textContent.trim());
    p.classList.add('split-probe--fit');
    h1.append(p);
    return p;
  });
  const em = Math.max(...probes.map((p) => p.getBoundingClientRect().width)) / 100;
  probes.forEach((p) => p.remove());
  h1.style.setProperty('--h1-fit', `${Math.floor((column / em) * 100) / 100}px`);
}

/** Keeps --h1-fit current: after the fonts load, when late fonts arrive, and on resize. Needs no library. */
export function initHeroFit() {
  const h1 = document.querySelector('.hero-name');
  if (!h1) return;
  const run = () => fitHeroName(h1);
  fontsReady().then(run);
  document.fonts?.addEventListener('loadingdone', run);
  window.addEventListener('resize', run);
}

// ---------------------------------------------------------------- reveals

// Per selector: the split mode, whether the letters also resolve from condensed, and the hero's sequencing
// (delay, plus step per matched element). Elements are revealed when they scroll into view, once.
const TARGETS = [
  { selector: '.hero-name', mode: 'letters', width: true },
  { selector: '.hero-role', mode: 'words', delay: 0.25 },
  { selector: '.hero-lead', mode: 'words', delay: 0.35 },
  { selector: '.figure-value', mode: 'letters', delay: 0.5, step: 0.1 },
  { selector: 'main h2', mode: 'letters', width: true },
  { selector: '.section-body, .section-sub, .about-bio', mode: 'words' },
];
const STAGGER = { words: 0.04, letters: 0.022 };
const WDTH = { from: 62, to: 112 };

/**
 * Arms and plays the reveals (spec §3.3). Everything lives inside gsap.matchMedia, so under reduced motion
 * nothing is split or hidden (the text is simply there) and a change of the preference re-runs this. The units
 * are hidden by gsap only after the split, so without gsap (or after any error here) the text stays visible.
 * Returns the promise that settles once the fonts are in and the word widths are locked (callbacks added to it
 * run after the lock), so ScrollTrigger can refresh against the final layout.
 */
export function initReveals(ctx) {
  const { gsap, ScrollTrigger } = ctx;
  const ready = fontsReady();
  gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
    const split = [];
    for (const { selector, mode, width = false, delay = 0, step = 0 } of TARGETS) {
      document.querySelectorAll(selector).forEach((el, i) => {
        try {
          const units = splitText(el, mode);
          if (width) el.classList.add('split-wdth');
          const from = { y: '0.35em', opacity: 0, ...(width && { '--wdth': WDTH.from }) };
          gsap.set(units, { ...from });   // armed in the same task as the split: a paused timeline would only render on the next tick
          const tl = gsap.timeline({ paused: true, delay: delay + i * step });
          tl.fromTo(
            units,
            { ...from },
            { y: 0, opacity: 1, ...(width && { '--wdth': WDTH.to }), duration: 0.9, ease: 'expo.out', stagger: STAGGER[mode] },
          );
          ScrollTrigger.create({
            trigger: el,
            start: 'top 88%',
            onEnter: (self) => { self.kill(); veil.onLift(() => tl.play()); },
          });
          split.push({ el, width });
        } catch (err) {
          console.error(err);
          unsplit(el);
        }
      });
    }

    // The lock measures at the hero name's final font-size, so the fit runs first (it is idempotent).
    const h1 = document.querySelector('.hero-name');
    const relayout = () => {
      if (h1) fitHeroName(h1);
      for (const { el, width } of split) if (width) lockWidths(el);
    };
    ready.then(relayout);
    document.fonts?.addEventListener('loadingdone', relayout);
    window.addEventListener('resize', relayout);
    return () => {
      document.fonts?.removeEventListener('loadingdone', relayout);
      window.removeEventListener('resize', relayout);
      for (const { el } of split) unsplit(el);
    };
  });
  return ready;
}

// ---------------------------------------------------------------- count-up

/**
 * Counts a numeric metric up from 0 to the text it holds (power2.out, 1.2 s), keeping its prefix, decimals,
 * separators and suffix. Returns the tween, or null when the text is not a number or motion is reduced (the
 * text is left as it is). Screen readers get the final value in a .sr-only copy while the digits run.
 */
export function countUp(el, gsap) {
  const parts = parseMetric(el.textContent);
  if (!parts || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const final = el.textContent;
  const shown = document.createElement('span');
  shown.setAttribute('aria-hidden', 'true');
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = final;
  el.style.minWidth = `${el.getBoundingClientRect().width}px`;   // the digits change width as they run
  el.replaceChildren(sr, shown);
  const state = { v: 0 };
  const render = () => { shown.textContent = formatMetric(parts, state.v); };
  const done = () => { el.textContent = final; el.style.minWidth = ''; };
  render();
  return gsap.to(state, { v: parts.value, duration: 1.2, ease: 'power2.out', onUpdate: render, onComplete: done, onInterrupt: done });
}
