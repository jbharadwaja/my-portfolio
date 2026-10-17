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
 * Lenis is created only without reduced motion, and only when main.js passes it (gsap's ticker drives it).
 * Without Lenis, scrolling is native and every scrollTo is instant.
 */
export function createScroll({ Lenis, gsap, ScrollTrigger, reduced }) {
  const root = document.documentElement;
  const sections = [...document.querySelectorAll('main > section')];
  let lenis = null;

  if (Lenis && !reduced) {
    lenis = new Lenis({ autoRaf: false, anchors: false });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000), false, true);
    gsap.ticker.lagSmoothing(0);
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
    document.body.style.backgroundColor = root.dataset.ground === 'night' ? 'var(--bg-dark)' : 'var(--bg)';
    const out = layers.map((el) => el.animate([{ opacity: 0 }], { duration: ms.out, easing: 'ease-in', fill: 'forwards' }));
    await Promise.all(out.map((a) => a.finished));
    scrollTo(y, { immediate: true });
    ScrollTrigger?.update();
    await new Promise(requestAnimationFrame);
    const back = layers.map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms.in, easing: 'ease-out' }));
    out.forEach((a) => a.cancel());
    await Promise.all(back.map((a) => a.finished));
    document.body.style.backgroundColor = '';
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

  // Counted, so two overlays (burger sheet, console) can hold the lock at once.
  let locks = 0;
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

  return {
    lenis,
    scrollTo,
    jumpTo,
    lock,
    unlock,
    sectionIndex: () => currentSection(tops(), centreY()),
  };
}
