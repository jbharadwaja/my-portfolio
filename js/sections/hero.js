// The hero (spec §2.2, §4.3, §6.1): the portrait formation and where it sits (the strip right of the name, or the
// slot after the lead — Ruling R47), its preparation before the veil lifts (decode, build, compile) and the denoise
// entrance after it. portraitLayout and entranceMode are pure and Node-testable; init(ctx) touches the DOM and
// receives gsap, the scroll and the engine through ctx (this module imports no CDN library).
import { veil } from '../ui/veil.js';
import { mulberry32 } from '../engine/formations/common.js';
import { buildPortrait } from '../engine/formations/portrait.js';

const PORTRAIT_URL = 'assets/img/portrait-cutout.webp';
const GRID_W = 400;                    // the weight grid is 400 cells wide (spec §4.2): decode straight to that
const SEED = 0x4a42;                   // the seed the hero HUD prints
const STEPS = 50;
const ENTRANCE_S = 2.4;
const ENTRANCE_REDUCED_S = 0.6;        // reduced motion: a cross-fade (spec §3.3)
const RUSH = 6;                        // timeScale after the first scroll input: done within 0.4 s
// Any scroll counts (a scrollbar drag, autoscroll, a nav jump, Lenis), as do the inputs that start one
const RUSH_INPUTS = ['wheel', 'touchmove', 'keydown', 'scroll'];
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);
const RESIZE_DEBOUNCE_MS = 150;
const STRIP = { gap: 32, margin: 48, minShare: 0.34, minWidth: 1024, top: 0.1, bottom: 0.96 };
const KEEP_FEATHER = 32;               // the text keep-out's feather in CSS px (spec §4.5; shaders.js keepOut)

const roundRect = ({ x, y, w, h }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });

/**
 * The slot's rect as the portrait is framed into it (rounded). A slot that ends on the stage at scroll 0 is used as
 * it lies. One that runs past the stage's bottom edge (a short stage, e.g. a landscape phone, where the copy above
 * the slot already fills the first screen) is framed where it sits once scrolled fully onto the stage: moved up to
 * end at the stage's bottom, but never above `copyTop`, where the copy's paper ground starts. The portrait is held
 * still while the copy scrolls, so at scroll 0 it is under that ground instead of peeking out above the copy, and
 * it shows through the slot as the slot scrolls in. Null if no stage is left below `copyTop`.
 */
function slotOnStage(slot, vh, copyTop) {
  const rect = roundRect(slot);
  const stageBottom = Math.round(vh);
  if (rect.y + rect.h <= stageBottom) return rect;
  const y = Math.max(stageBottom - rect.h, Math.round(copyTop));
  return y < stageBottom ? { x: rect.x, y, w: rect.w, h: stageBottom - y } : null;
}

/**
 * Where the portrait is framed (spec §2.2), in CSS px of a vw × vh stage: the strip [h1Right + 32, vw − 48],
 * 10%–96% of the stage height, when the viewport is ≥ 1024 px wide and the strip is ≥ 34% of it. Otherwise the
 * bottom layout: the portrait slot (Ruling R47: the slot after the lead), measured as laid out at scroll 0 and
 * kept on the stage (slotOnStage; `copyTop` is the copy's top at scroll 0), or, when no slot is measured, the
 * bottom half of the stage. Every rect field is a whole pixel.
 */
export function portraitLayout({ vw, vh, h1Right, slotRect = null, copyTop = 0 }) {
  const x = h1Right + STRIP.gap;
  const w = vw - STRIP.margin - x;
  // The share as a quotient: 0.34 · 1250 is 425.00000000000006, but 425 / 1250 rounds to exactly 0.34.
  if (vw >= STRIP.minWidth && w / vw >= STRIP.minShare) {
    return { mode: 'strip', rect: roundRect({ x, y: STRIP.top * vh, w, h: (STRIP.bottom - STRIP.top) * vh }) };
  }
  const slot = slotRect && slotOnStage(slotRect, vh, copyTop);
  if (slot) return { mode: 'bottom', rect: slot };
  return { mode: 'bottom', rect: roundRect({ x: 0, y: vh / 2, w: vw, h: vh / 2 }) };
}

/** The entrance plays only if the page is in the hero when the veil lifts (not at a restored position or a #hash). */
export function entranceMode({ inHero }) {
  return inHero ? 'play' : 'skip';
}

/** Whether an event rushes the entrance: every scroll input except a lone modifier key (Shift, Control, Alt, Meta). */
export function rushInput({ type, key }) {
  return !(type === 'keydown' && MODIFIER_KEYS.has(key));
}

/** The cut-out as ImageData, decoded straight to `width` px wide. */
async function loadPortrait(url, width) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { resizeWidth: width, resizeQuality: 'high' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    return g.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

const sameRect = (a, b) => a === b || (Boolean(a && b) && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/**
 * The portrait's rect and the hero's keep-out rects, measured from the DOM. The pose reads `rect` every frame, so it
 * is cached here and re-measured only on resize, late fonts and the veil lift. The stage height is 100svh (the
 * sticky stages' height), which mobile toolbars showing or hiding do not change.
 */
function createLayout({ section, h1, copy, slot, header }) {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  let mode = '';
  let safe = null;

  /** Returns { changed } (anything the engine reads) and { moved } (the slot came or went: the page height changed). */
  function measure() {
    const vw = document.documentElement.clientWidth;
    const vh = probe.getBoundingClientRect().height || innerHeight;
    const h1Right = h1.getBoundingClientRect().right;
    let next = portraitLayout({ vw, vh, h1Right });
    // The class shows the slot (css/main.css), so it is set before the slot is measured. The name sits above the
    // slot, so showing or hiding it never moves h1Right.
    const bottom = next.mode === 'bottom';
    const moved = bottom !== section.classList.contains('portrait-bottom');
    section.classList.toggle('portrait-bottom', bottom);
    // Everything as laid out at scroll 0, where the hero is held: the hero starts the page, so an offset in the
    // section is a viewport position at the top.
    const top0 = section.getBoundingClientRect().top;
    const at0 = (r) => ({ x: r.left, y: r.top - top0, w: r.width, h: r.height });
    const c = at0(copy.getBoundingClientRect());
    // The fixed header's band keeps particles out too: at the top of the page the header has no ground yet (Ruling
    // R50), and the entrance's swirl and fly-through would otherwise pass behind its items.
    const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
    const band = headerBottom > 0 ? { x: 0, y: 0, w: vw, h: headerBottom } : null;
    let nextSafe = [c.h > 0 ? c : null, band];
    const s = bottom && slot ? at0(slot.getBoundingClientRect()) : null;
    if (s && s.w > 0 && s.h > 0) {
      // On a short stage the slot runs past the fold, and the portrait is framed where the slot sits once it has
      // scrolled fully onto the stage (portraitLayout), no higher than the copy's top.
      next = portraitLayout({ vw, vh, h1Right, slotRect: s, copyTop: c.y });
      // Keep-out, two rects: above the slot, the header band and the copy down to the lead (full width); below it,
      // the copy from the meta rows on (the panels, actions and socials). Neither reaches into the portrait's rect,
      // feather included: on a short stage the rect reaches up behind the copy above the slot, where the copy's own
      // paper ground hides it until the slot scrolls in, and a keep-out there would fade the face for good (keep-outs
      // do not scroll). Copy that scrolls over the held portrait later sits on the opaque panels or its own paper
      // ground (css/main.css, .portrait-bottom), which move with the text.
      const aboveEnd = slot.previousElementSibling ? at0(slot.previousElementSibling.getBoundingClientRect()) : null;
      const belowStart = slot.nextElementSibling ? at0(slot.nextElementSibling.getBoundingClientRect()) : null;
      const upperH = Math.max(band?.h ?? 0, Math.min(aboveEnd ? aboveEnd.y + aboveEnd.h : s.y, next.rect.y - KEEP_FEATHER));
      const lowerY = belowStart ? belowStart.y : s.y + s.h;
      const lowerH = c.y + c.h - lowerY;
      nextSafe = [
        upperH > 0 ? { x: 0, y: 0, w: vw, h: upperH } : null,
        lowerH > 0 ? { x: c.x, y: lowerY, w: c.w, h: lowerH } : null,
      ];
      // The copy's paper ground stops at the slot's top (it never covers the face).
      copy.style.setProperty('--slot-top', `${Math.round(s.y - c.y)}px`);
    } else if (bottom) {
      // No slot to frame into: the bottom half of the stage, and only the copy above it keeps particles out.
      const height = Math.min(c.h, next.rect.y - c.y);
      nextSafe = [height > 0 ? { ...c, h: height } : null, band];
    }
    const changed = next.mode !== mode || !sameRect(next.rect, rect) || !nextSafe.every((r, i) => sameRect(r, safe?.[i] ?? null));
    Object.assign(rect, next.rect);
    mode = next.mode;
    safe = nextSafe;
    return { changed, moved };
  }

  return { rect, measure, get safe() { return safe; } };
}

/**
 * Starts decoding the cut-out at once (it does not wait for three), and once the engine exists builds the noise
 * and portrait formations eagerly and compiles the shaders, reporting each stage to the veil. Returns a promise
 * that settles when the hero is ready to show — it never rejects, and never settles if the engine never arrives
 * (the 8 s cap lifts the veil then). When the veil lifts the entrance plays, or is skipped.
 */
export function init(ctx) {
  const section = document.getElementById('top');
  const h1 = section?.querySelector('.hero-name');
  const copy = section?.querySelector('.hero-copy');
  const slot = section?.querySelector('.hero-portrait-slot');
  const step = section?.querySelector('.hero-step');
  const header = document.querySelector('.site-header');
  if (!section || !h1 || !copy) return Promise.resolve();

  let shownStep = Number(step?.textContent) || 1;
  const showStep = (n) => {
    if (n === shownStep || !step) return;
    shownStep = n;
    step.textContent = String(n).padStart(2, '0');
  };

  const image = loadPortrait(PORTRAIT_URL, GRID_W).then((data) => {
    veil.report('portrait');
    return data;
  }, (err) => {
    veil.dropKey('portrait');
    window.__veil?.banner(new URL(PORTRAIT_URL, document.baseURI).href);
    throw err;
  });
  image.catch(() => {});               // reported above; the portrait builder awaits it and fails in turn

  let prepared = false;
  let relayout = () => {};
  const ready = ctx.engineReady.then(async (engine) => {
    if (!engine) {
      veil.dropKey('formations');
      veil.dropKey('compile');
      return;
    }
    const layout = createLayout({ section, h1, copy, slot, header });
    // Formation 0 (the noise the portrait denoises from) is framed into the same rect, so the face resolves in place.
    const pose = { roll: 0, rect: () => layout.rect };
    relayout = () => {
      const { changed, moved } = layout.measure();
      if (moved) ctx.ScrollTrigger?.refresh();   // the slot came or went: every later section moved
      if (!changed) return;
      engine.setSafeRects({ 0: layout.safe, 1: layout.safe });
      engine.setPose(0, pose);   // re-runs each built formation's density estimate at the new framing
      engine.setPose(1, pose);
    };
    relayout();
    let resizeTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, RESIZE_DEBOUNCE_MS);
    });
    // The name's width (the strip) and the copy's height (the slot's place) follow the fonts.
    document.fonts?.addEventListener('loadingdone', relayout);
    document.fonts?.ready.then(() => relayout());

    engine.registerFormation(1, async () => buildPortrait(ctx.tier.N, { image: await image, rng: mulberry32(SEED) }));
    try {
      await Promise.all([engine.ensure(0), engine.ensure(1)]);
      veil.report('formations');
    } catch {
      veil.dropKey('formations');      // the engine has logged the failed build; the hero shows the noise instead
    }
    await engine.compile();
    veil.report('compile');
    prepared = true;
  }).catch((err) => console.error('Hero preparation failed.', err));

  veil.onLift(() => {
    relayout();
    const inHero = ctx.scroll.sectionIndex() === 0;
    if (prepared && ctx.gsap && entranceMode({ inHero }) === 'play') playEntrance(ctx, showStep);
    else skipEntrance(ctx, showStep);
  });

  return ready;
}

/** Restored position, #hash, late engine or no gsap: the portrait is simply there, and the HUD reads 50 / 50. */
function skipEntrance({ boundaries }, showStep) {
  boundaries[0] = 1;
  showStep(STEPS);
}

/**
 * Boundary 0 (noise → portrait) runs 0 → 1 over 2.4 s from the frame the veil starts fading (0.6 s cross-fade
 * under reduced motion); the HUD counts the denoise steps 01 → 50 with the time. The first scroll input (rushInput)
 * or scroll speeds the rest up ×6; until it reports 1 the engine holds the Hero → Encoder mix at 0
 * (resolver.applyEntrance).
 */
function playEntrance({ gsap, boundaries, reduced }, showStep) {
  const proxy = { mix: 0 };
  boundaries[0] = 0;
  const rush = (e) => {
    if (!rushInput(e)) return;
    tween.timeScale(RUSH);
    stopListening();
  };
  const stopListening = () => RUSH_INPUTS.forEach((type) => removeEventListener(type, rush));
  const tween = gsap.to(proxy, {
    mix: 1,
    duration: reduced ? ENTRANCE_REDUCED_S : ENTRANCE_S,
    ease: reduced ? 'none' : 'power2.inOut',
    onUpdate() {
      boundaries[0] = proxy.mix;
      showStep(Math.max(1, Math.round(this.progress() * STEPS)));
    },
    onComplete() {
      stopListening();
      skipEntrance({ boundaries }, showStep);
    },
  });
  RUSH_INPUTS.forEach((type) => addEventListener(type, rush, { passive: true }));
}
