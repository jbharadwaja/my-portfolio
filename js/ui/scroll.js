// The only door to scrolling: smooth scroll, jumps, the scroll lock and the current section.
// The pure helpers are Node-testable. createScroll receives the libraries from main.js (this module imports
// none of them) and touches the DOM only when it is called.

const ANIMATE_MAX_S = 1;                       // adjacent jumps: an animated scroll of at most 1.0 s
const CUT_MS = { out: 180, in: 320 };          // far jumps: fade out, jump, fade back in
const CUT_MS_REDUCED = { out: 0, in: 120 };
const SCRUB_NATIVE_S = 0.3;                    // a scrub's smoothing on native scroll (none with Lenis, which smooths already)

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

/** The ground colour the page shows now (`root` is <html>: data-ground, the Route's night), to pin on <body>. */
export function groundFill(root) {
  return root.dataset.ground === 'night' ? 'var(--bg-dark)' : 'var(--bg)';
}

/** The scrub smoothing a ScrollTrigger takes: none while Lenis smooths the scroll, 0.3 s on native scroll. */
export function scrubFor(lenisOn) {
  return lenisOn ? true : SCRUB_NATIVE_S;
}

/** Index of the last section whose top is at or above y (page coordinates); 0 above the first. */
export function currentSection(tops, y) {
  let i = 0;
  while (i + 1 < tops.length && tops[i + 1] <= y) i++;
  return i;
}

/**
 * Where offset y sits: the section holding it (as currentSection) and how far through that section, 0..1.
 * `heights` are the sections' heights; past the last section (the footer) the fraction is 1. `ranges` are the
 * lengths their sticky stages hold for (0 for a section without one): while y is inside a held stage, `progress` is
 * how far through that hold, 0..1 — the stage's own scrub, which a new viewport size keeps although the section's
 * height and its hold change by different amounts.
 */
export function anchorAt(tops, heights, y, ranges = []) {
  const index = currentSection(tops, y);
  const height = heights[index];
  const place = { index, fraction: height > 0 ? clamp01((y - tops[index]) / height) : 0 };
  const range = ranges[index];
  if (range > 0 && y >= tops[index] && y - tops[index] <= range) place.progress = (y - tops[index]) / range;
  return place;
}

/**
 * How far below its section's top a place lies, in px: its stage's progress through the hold when it has one and
 * the section now holds (`range` > 0), else its fraction of the section's height.
 */
export function offsetFor(place, height, range) {
  if (range > 0 && Number.isFinite(place.progress)) return clamp01(place.progress) * range;
  return clamp01(place.fraction ?? 0) * height;
}

const isPlace = (p, ids) => Boolean(p) && typeof p.id === 'string' && ids.includes(p.id) && Number.isFinite(p.fraction);

/**
 * The place to put the page at boot, so a reload or a deep link lands on the right section. Both saved places are
 * written on pagehide: `entry` into the history entry's state, `tab` into the tab's sessionStorage. A back/forward
 * visit restores only its own entry's place, so it never lands where a newer entry was. A reload restores the tab's
 * place first — the reloaded page's own pagehide wrote it last, while Chrome drops a replaceState made in a reload's
 * pagehide and keeps the entry's older state — then the entry's. Any other visit, or no usable saved place, lands
 * where a jump to the #hash's section (`hashId`) lands (`land`: its landing point, or its start), or nowhere (null).
 * `ids` are the section ids.
 */
export function placeToRestore({ visit, entry, tab, hashId, ids }) {
  if (visit === 'reload' && isPlace(tab, ids)) return tab;
  if ((visit === 'reload' || visit === 'back_forward') && isPlace(entry, ids)) return entry;
  return hashId && ids.includes(hashId) ? { id: hashId, fraction: 0, land: true } : null;
}

/** Whether a viewport change from `a` to `b` makes ScrollTrigger refresh: on a touch-only device a height change
 *  under 25% with the same width (a mobile URL bar) is ignored, as ScrollTrigger's ignoreMobileResize does. */
export function resizeRefreshes(a, b, touchOnly) {
  if (a.w === b.w && a.h === b.h) return false;
  return !touchOnly || a.w !== b.w || Math.abs(b.h - a.h) > b.h * 0.25;
}

/**
 * Scrolling starts native: main.js creates this before the CDN imports settle, so nav works even when a slow CDN
 * lets the 8 s cap lift the veil first, and calls attach() once they resolve. That upgrades the same object in
 * place, so the handlers holding it and any lock already taken carry over. Passing the libraries here attaches at
 * once. Lenis exists only without reduced motion (gsap's ticker drives it); setReduced() follows a change of the
 * preference at runtime, destroying or creating it, and the triggers handed to followScrub() take
 * the smoothing that goes with it. Without Lenis every scrollTo is instant.
 * Once attached, the reader keeps their place through a resize or a rotation (keepPlace).
 */
export function createScroll({ Lenis = null, gsap = null, ScrollTrigger = null, reduced = false } = {}) {
  const root = document.documentElement;
  const sections = [...document.querySelectorAll('main > section')];
  let lenis = null;
  let libraries = null;          // { Lenis, gsap, ScrollTrigger }, once attached
  let trigger = null;            // ScrollTrigger, once attached
  let locks = 0;                 // counted, so two overlays (burger sheet, console) can hold the lock at once
  let jumping = 0;               // jumps running (a cut holds this until it has faded back in)
  const raf = (t) => lenis?.raf(t * 1000);
  const scrubbed = new Set();    // the ScrollTriggers whose smoothing follows Lenis (followScrub)
  const smooth = (st) => st.scrubDuration?.(scrubFor(Boolean(lenis)));
  const smoothScrubs = () => scrubbed.forEach(smooth);
  const landings = new Map();    // section id → () => y: where a jump to it lands (setLanding)

  function startLenis() {
    if (lenis || reduced || !libraries?.Lenis) return;
    lenis = new libraries.Lenis({ autoRaf: false, anchors: false });
    lenis.on('scroll', trigger.update);
    libraries.gsap.ticker.add(raf, false, true);
    libraries.gsap.ticker.lagSmoothing(0);
    if (locks > 0) lenis.stop();
    smoothScrubs();
  }

  function stopLenis() {
    if (!lenis) return;
    libraries.gsap.ticker.remove(raf);
    lenis.destroy();
    lenis = null;
    smoothScrubs();
  }

  function attach(libs) {
    if (trigger || !libs.ScrollTrigger) return;
    libraries = libs;
    trigger = libs.ScrollTrigger;
    startLenis();
    keepPlace();
  }

  /** prefers-reduced-motion changed: native scroll and quicker cuts under reduce, Lenis again without it. */
  function setReduced(on) {
    if (on !== reduced) holdPlace();   // gsap.matchMedia's refresh measures from the top and would leave the page there
    reduced = on;
    if (on) stopLenis();
    else startLenis();
  }

  // Sections are never sticky themselves (their stages are), so a rect gives each one's trigger-equivalent top.
  const pageTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const tops = () => sections.map(pageTop);
  const heightOf = (el) => el.getBoundingClientRect().height;
  // How long a section's sticky stage holds (its height less the stage's), 0 while the stages are not sticky.
  const rangeOf = (el) => {
    if (!root.classList?.contains('js-scroll') || !el.classList?.contains('pin')) return 0;
    const stage = el.querySelector?.('.stage');
    return stage ? Math.max(0, heightOf(el) - stage.getBoundingClientRect().height) : 0;
  };
  const centreY = () => window.scrollY + window.innerHeight / 2;
  /** Where a jump to section `el` lands: its landing point (setLanding), else its top. */
  const landingY = (el) => {
    const at = landings.get(el.id)?.();
    return Number.isFinite(at) ? at : pageTop(el);
  };

  // Lenis clamps every scroll to the page height it last measured, and re-measures only 250 ms after the page grows
  // (its debounced resize): the stages set their lengths at boot, so a deep link or a reload near the end of the
  // page would be clamped short. It also skips a scroll to where it believes the page already is, and a ScrollTrigger
  // refresh moves the page behind its back (it measures from the top). Either way it re-reads first (resize()).
  function fresh(y) {
    if (!lenis || typeof lenis.resize !== 'function') return;
    const behind = !lenis.isScrolling && Math.abs(lenis.targetScroll - window.scrollY) > 1;
    if (y > lenis.limit || behind) lenis.resize();
  }

  // Every scroll asked for here is forced: the lock (an open overlay) stops Lenis, and a stopped Lenis drops an
  // unforced scrollTo, so a jump asked for while locked would be lost where native scroll still moves the page.
  function scrollTo(y, { immediate = false } = {}) {
    fresh(y);
    if (lenis) lenis.scrollTo(y, immediate ? { immediate: true, force: true } : { force: true });
    else window.scrollTo({ top: y, behavior: 'instant' });
  }

  function glide(y) {
    if (!lenis) return scrollTo(y);
    fresh(y);
    const screens = Math.abs(y - window.scrollY) / window.innerHeight;
    lenis.scrollTo(y, { duration: Math.min(ANIMATE_MAX_S, 0.6 + 0.2 * screens), force: true });
  }

  // Fade <main> and the canvas to the current ground, jump, let one frame render there, fade back in.
  // The ground colour is pinned on <body> for the whole cut, so passing in or out of Route never flashes.
  // The target is measured once faded out (`targetY()`): the layout can change meanwhile (the libraries arriving
  // lengthen the stages). `landed` runs once the page is there, while both layers are still faded out.
  async function cut(targetY, landed) {
    const ms = reduced ? CUT_MS_REDUCED : CUT_MS;
    const layers = [document.querySelector('main'), document.getElementById('scene')].filter(Boolean);
    let out = [];
    let back = [];
    document.body.style.backgroundColor = groundFill(root);
    try {
      out = layers.map((el) => el.animate([{ opacity: 0 }], { duration: ms.out, easing: 'ease-in', fill: 'forwards' }));
      await Promise.all(out.map((a) => a.finished));
      // Both run every ScrollTrigger callback synchronously (Lenis through its scroll emit), so a section module can throw here.
      scrollTo(targetY(), { immediate: true });
      trigger?.update();
      landed();
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

  // 'jump' listeners: { mode, targetIndex } as a jump runs — an animated one as its glide starts, a cut once the page
  // has moved and before it fades back in (the Route snaps its ground there, the engine rebinds its pair). A listener
  // that throws is logged.
  const jumpListeners = new Set();
  function emitJump(detail) {
    for (const fn of jumpListeners) {
      try {
        fn(detail);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // Jumps run one after another, so a second click never interleaves with a cut in progress.
  let queue = Promise.resolve();
  function jumpTo(target) {
    const run = async () => {
      const el = typeof target === 'string' ? document.getElementById(target) : null;
      if (typeof target === 'string' && !el) return;
      const targetY = () => (el ? landingY(el) : target);
      const y = targetY();
      const all = tops();
      const targetIndex = currentSection(all, y);
      const mode = jumpMode(currentSection(all, centreY()), targetIndex);
      jumping++;
      try {
        if (mode === 'cut') return await cut(targetY, () => emitJump({ mode, targetIndex }));
        emitJump({ mode, targetIndex });
        return glide(y);
      } finally {
        jumping--;
      }
    };
    queue = queue.then(run).catch((err) => console.error(err));
    return queue;
  }

  // While locked the page loses its scrollbar (overflow: hidden). On a classic (non-overlay) scrollbar its gutter
  // stays (scrollbar-gutter), so nothing shifts sideways; where a browser does not keep the gutter, the page is padded
  // by the width the scrollbar gave back, and the fixed header takes it as --lock-gap (css/main.css).
  function lock() {
    if (locks++ > 0) return;
    const width = document.body.clientWidth;   // before Lenis stops: its .lenis-stopped clips the page's overflow too
    lenis?.stop();
    root.style.scrollbarGutter = 'stable';
    root.style.overflow = 'hidden';
    const gap = document.body.clientWidth - width;
    if (gap > 0) {
      root.style.paddingRight = `${gap}px`;
      root.style.setProperty?.('--lock-gap', `${gap}px`);
    }
  }
  function unlock() {
    if (locks === 0 || --locks > 0) return;
    lenis?.start();
    root.style.overflow = '';
    root.style.scrollbarGutter = '';
    root.style.paddingRight = '';
    root.style.removeProperty?.('--lock-gap');
  }

  /** Where the page is in the current layout: { id, fraction } and, inside a held stage, its progress. */
  function anchor() {
    const { index, fraction, progress } = anchorAt(tops(), sections.map(heightOf), window.scrollY, sections.map(rangeOf));
    const place = { id: sections[index]?.id ?? '', fraction };
    if (progress !== undefined) place.progress = progress;
    return place;
  }

  /** Puts the page at a place at once (a reload, a #hash: `land`); false when no section has that id. */
  function toAnchor(place) {
    const el = sections.find((s) => s.id === place?.id);
    if (!el) return false;
    scrollTo(place.land ? landingY(el) : pageTop(el) + offsetFor(place, heightOf(el), rangeOf(el)), { immediate: true });
    return true;
  }

  // keepPlace: every section is sized in viewport units, so after a resize or a rotation the same scrollY sits in
  // another section. By the time the resize event runs the page has already reflowed (and the browser may have
  // clamped or anchored the scroll), so the place is read against the layout of the last ScrollTrigger refresh
  // (`laidOut`) and the last scroll seen in it (`seenY`). A resize ScrollTrigger refreshes for stops the reading;
  // the first refresh after it puts the page back there, unless a jump is running (it measures its own target). A
  // live reduced-motion switch holds the place the same way (holdPlace): its refresh measures from the top.
  let laidOut = null;            // { tops, heights, ranges, w, h } at the last refresh
  let seenY = 0;
  let held = false;              // the scroll no longer reads against laidOut: restore at the next refresh
  let holdTimer = 0;

  function holdPlace() {
    if (!laidOut || held) return;
    held = true;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(settle, 1000);   // a resize ScrollTrigger let pass after all: put the page back anyway
  }

  function settle() {
    clearTimeout(holdTimer);
    if (held && laidOut && jumping === 0) {
      const { index, fraction, progress } = anchorAt(laidOut.tops, laidOut.heights, seenY, laidOut.ranges);
      if (sections[index]) toAnchor({ id: sections[index].id, fraction, progress });
    }
    held = false;
    laidOut = {
      tops: tops(), heights: sections.map(heightOf), ranges: sections.map(rangeOf),
      w: window.innerWidth, h: window.innerHeight,
    };
    seenY = window.scrollY;
  }

  function keepPlace() {
    if (typeof trigger.addEventListener !== 'function' || typeof window.addEventListener !== 'function') return;
    trigger.addEventListener('refresh', settle);
    window.addEventListener('scroll', () => {
      if (!held) seenY = window.scrollY;
    }, { passive: true });
    window.addEventListener('resize', () => {
      if (laidOut && resizeRefreshes(laidOut, { w: window.innerWidth, h: window.innerHeight }, trigger.isTouch === 1)) holdPlace();
    });
  }

  if (ScrollTrigger) attach({ Lenis, gsap, ScrollTrigger });

  return {
    /** The Lenis instance, or null on native scroll (before attach, under reduced motion, or without the libraries). */
    get lenis() { return lenis; },
    attach,
    setReduced,
    /**
     * A scrubbed ScrollTrigger (created with any scrub but a toggle) takes scrubFor's smoothing now, and again each
     * time Lenis is created or destroyed (a live reduced-motion switch, setReduced), through its scrubDuration().
     */
    followScrub(st) {
      if (!st) return;
      scrubbed.add(st);
      smooth(st);
    },
    scrollTo,
    jumpTo,
    /**
     * setLanding(id, fn): a jump to section `id` (nav, console, a #hash visit) lands at fn()'s page y instead of the
     * section's top — a sticky stage whose start shows nothing yet (the Route). fn null removes it.
     */
    setLanding(id, fn) {
      if (typeof fn === 'function') landings.set(id, fn);
      else landings.delete(id);
    },
    /** on('jump', fn): fn({ mode: 'cut' | 'animate', targetIndex }) on each jump (emitJump); returns its off switch. */
    on(type, fn) {
      if (type !== 'jump') return () => {};
      jumpListeners.add(fn);
      return () => jumpListeners.delete(fn);
    },
    lock,
    unlock,
    sectionIndex: () => currentSection(tops(), centreY()),
    /** Where the page is: the section at the viewport's top edge, the fraction scrolled through it and, inside a
     *  held stage, its progress: { id, fraction, progress? }. */
    anchor,
    toAnchor,
  };
}
