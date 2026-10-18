// The only door to scrolling (spec §5.4): smooth scroll, jumps, the scroll lock and the current section.
// The pure helpers are Node-testable. createScroll receives the libraries from main.js (this module imports
// none of them) and touches the DOM only when it is called.

const ANIMATE_MAX_S = 1;                       // adjacent jumps: an animated scroll of at most 1.0 s
const CUT_MS = { out: 180, in: 320 };          // far jumps: fade out, jump, fade back in
const CUT_MS_REDUCED = { out: 0, in: 120 };

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** How a jump between two sections runs: the same or a neighbouring section animates, anything further cuts. */
export function jumpMode(fromIdx, toIdx) {
  return Math.abs(toIdx - fromIdx) <= 1 ? 'animate' : 'cut';
}

/** The page scroll that centres a rail card: the rail trigger's start plus the card's share of the rail travel. */
export function railScrollFor({ stStart, stEnd, cardLeft, cardWidth, innerWidth, railTravel }) {
  const share = railTravel > 0 ? clamp01((cardLeft + cardWidth / 2 - innerWidth / 2) / railTravel) : 0;
  return stStart + share * (stEnd - stStart);
}

/** Index of the last section whose top is at or above y (page coordinates); 0 above the first. */
export function currentSection(tops, y) {
  let i = 0;
  while (i + 1 < tops.length && tops[i + 1] <= y) i++;
  return i;
}

/**
 * Where offset y sits: the section holding it (as currentSection) and how far through that section, 0..1.
 * `heights` are the sections' heights; past the last section (the footer) the fraction is 1.
 */
export function anchorAt(tops, heights, y) {
  const index = currentSection(tops, y);
  const height = heights[index];
  return { index, fraction: height > 0 ? clamp01((y - tops[index]) / height) : 0 };
}

const isPlace = (p, ids) => Boolean(p) && typeof p.id === 'string' && ids.includes(p.id) && Number.isFinite(p.fraction);

/**
 * The place to put the page at boot (Review Focus #2). Both saved places are written on pagehide: `entry` into
 * the history entry's state, `tab` into the tab's sessionStorage. A back/forward visit restores only its own
 * entry's place, so it never lands where a newer entry was. A reload restores the tab's place first — the
 * reloaded page's own pagehide wrote it last, while Chrome drops a replaceState made in a reload's pagehide and
 * keeps the entry's older state — then the entry's. Any other visit, or no usable saved place, lands at the start
 * of the #hash's section (`hashId`), or nowhere (null). `ids` are the section ids.
 */
export function placeToRestore({ visit, entry, tab, hashId, ids }) {
  if (visit === 'reload' && isPlace(tab, ids)) return tab;
  if ((visit === 'reload' || visit === 'back_forward') && isPlace(entry, ids)) return entry;
  return hashId && ids.includes(hashId) ? { id: hashId, fraction: 0 } : null;
}

/**
 * Scrolling starts native: main.js creates this before the CDN imports settle, so nav works even when a slow CDN
 * lets the 8 s cap lift the veil first, and calls attach() once they resolve. That upgrades the same object in
 * place, so the handlers holding it and any lock already taken carry over. Passing the libraries here attaches at
 * once. Lenis is created only without reduced motion (gsap's ticker drives it); without Lenis every scrollTo is instant.
 */
export function createScroll({ Lenis = null, gsap = null, ScrollTrigger = null, reduced = false } = {}) {
  const root = document.documentElement;
  const sections = [...document.querySelectorAll('main > section')];
  let lenis = null;
  let trigger = null;            // ScrollTrigger, once attached
  let locks = 0;                 // counted, so two overlays (burger sheet, console) can hold the lock at once

  function attach(libs) {
    if (trigger || !libs.ScrollTrigger) return;
    trigger = libs.ScrollTrigger;
    if (!libs.Lenis || reduced) return;
    lenis = new libs.Lenis({ autoRaf: false, anchors: false });
    lenis.on('scroll', trigger.update);
    libs.gsap.ticker.add((t) => lenis.raf(t * 1000), false, true);
    libs.gsap.ticker.lagSmoothing(0);
    if (locks > 0) lenis.stop();
  }

  // Sections are never sticky themselves (their stages are), so a rect gives each one's trigger-equivalent top.
  const pageTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const tops = () => sections.map(pageTop);
  const centreY = () => window.scrollY + window.innerHeight / 2;

  function scrollTo(y, { immediate = false } = {}) {
    if (lenis) lenis.scrollTo(y, immediate ? { immediate: true, force: true } : {});
    else window.scrollTo({ top: y, behavior: 'instant' });
  }

  function glide(y) {
    if (!lenis) return scrollTo(y);
    const screens = Math.abs(y - window.scrollY) / window.innerHeight;
    lenis.scrollTo(y, { duration: Math.min(ANIMATE_MAX_S, 0.6 + 0.2 * screens) });
  }

  // Fade <main> and the canvas to the current ground, jump, let one frame render there, fade back in.
  // The ground colour is pinned on <body> for the whole cut, so passing in or out of Route never flashes.
  async function cut(y) {
    const ms = reduced ? CUT_MS_REDUCED : CUT_MS;
    const layers = [document.querySelector('main'), document.getElementById('scene')].filter(Boolean);
    let out = [];
    let back = [];
    document.body.style.backgroundColor = root.dataset.ground === 'night' ? 'var(--bg-dark)' : 'var(--bg)';
    try {
      out = layers.map((el) => el.animate([{ opacity: 0 }], { duration: ms.out, easing: 'ease-in', fill: 'forwards' }));
      await Promise.all(out.map((a) => a.finished));
      // Both run every ScrollTrigger callback synchronously (Lenis through its scroll emit), so a section module can throw here.
      scrollTo(y, { immediate: true });
      trigger?.update();
      await new Promise(requestAnimationFrame);
      back = layers.map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms.in, easing: 'ease-out' }));
      out.forEach((a) => a.cancel());
      await Promise.all(back.map((a) => a.finished));
    } finally {
      // Never leave the page faded out or the ground pinned; an error still reaches the jump queue's logger.
      for (const a of [...out, ...back]) a.cancel();
      document.body.style.backgroundColor = '';
    }
  }

  // Jumps run one after another, so a second click never interleaves with a cut in progress.
  let queue = Promise.resolve();
  function jumpTo(target) {
    const run = () => {
      const el = typeof target === 'string' ? document.getElementById(target) : null;
      if (typeof target === 'string' && !el) return;
      const y = el ? pageTop(el) : target;
      const all = tops();
      return jumpMode(currentSection(all, centreY()), currentSection(all, y)) === 'animate' ? glide(y) : cut(y);
    };
    queue = queue.then(run).catch((err) => console.error(err));
    return queue;
  }

  function lock() {
    if (locks++ > 0) return;
    lenis?.stop();
    root.style.overflow = 'hidden';
  }
  function unlock() {
    if (locks === 0 || --locks > 0) return;
    lenis?.start();
    root.style.overflow = '';
  }

  if (ScrollTrigger) attach({ Lenis, gsap, ScrollTrigger });

  return {
    /** The Lenis instance, or null on native scroll (before attach, under reduced motion, or without the libraries). */
    get lenis() { return lenis; },
    attach,
    scrollTo,
    jumpTo,
    lock,
    unlock,
    sectionIndex: () => currentSection(tops(), centreY()),
    /** Where the page is: the section at the viewport's top edge and the fraction scrolled through it, { id, fraction }. */
    anchor() {
      const { index, fraction } = anchorAt(tops(), sections.map((s) => s.getBoundingClientRect().height), window.scrollY);
      return { id: sections[index]?.id ?? '', fraction };
    },
    /** Puts the page at an anchor at once (a reload, a #hash: fraction 0); false when no section has that id. */
    toAnchor({ id, fraction = 0 }) {
      const el = sections.find((s) => s.id === id);
      if (!el) return false;
      scrollTo(pageTop(el) + clamp01(fraction) * el.getBoundingClientRect().height, { immediate: true });
      return true;
    },
  };
}
