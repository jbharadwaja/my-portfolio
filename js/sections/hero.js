// The hero (spec §2.2, §4.3, §6.1): the portrait formation and where it sits (the strip right of the name, or the
// bottom half of the stage), its preparation before the veil lifts (decode, build, compile) and the denoise
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
const SCROLL_INPUTS = ['wheel', 'touchmove', 'keydown'];
const RESIZE_DEBOUNCE_MS = 150;
const STRIP = { gap: 32, margin: 48, minShare: 0.34, minWidth: 1024, top: 0.1, bottom: 0.96 };

/**
 * Where the portrait is framed (spec §2.2), in CSS px of a vw × vh stage: the strip [h1Right + 32, vw − 48],
 * 10%–96% of the stage height, when the viewport is ≥ 1024 px wide and the strip is ≥ 34% of it; otherwise the
 * bottom half of the stage. Every rect field is rounded to a whole pixel.
 */
export function portraitLayout({ vw, vh, h1Right }) {
  const x = h1Right + STRIP.gap;
  const w = vw - STRIP.margin - x;
  if (vw >= STRIP.minWidth && w >= STRIP.minShare * vw) {
    const y = STRIP.top * vh;
    const h = (STRIP.bottom - STRIP.top) * vh;
    return { mode: 'strip', rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } };
  }
  return { mode: 'bottom', rect: { x: 0, y: Math.round(vh / 2), w: Math.round(vw), h: Math.round(vh / 2) } };
}

/** The entrance plays only if the page is in the hero when the veil lifts (not at a restored position or a #hash). */
export function entranceMode({ inHero }) {
  return inHero ? 'play' : 'skip';
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
 * The portrait's rect and the hero copy's keep-out rect, measured from the DOM. The pose reads `rect` every
 * frame, so it is cached here and re-measured only on resize, late fonts and the veil lift. The stage height is
 * 100svh (the sticky stages' height), which mobile toolbars showing or hiding do not change.
 */
function createLayout({ section, h1, copy }) {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  let mode = '';
  let safe = null;

  /** Returns true when anything changed. */
  function measure() {
    const vw = document.documentElement.clientWidth;
    const vh = probe.getBoundingClientRect().height || innerHeight;
    const next = portraitLayout({ vw, vh, h1Right: h1.getBoundingClientRect().right });
    // The copy where it sits while the hero is held (the hero starts the page, so its offset in the section is
    // its viewport position at the top). Under the bottom layout the portrait owns the bottom half: only copy
    // above it keeps particles out (the whole copy block would leave the portrait at 12% alpha). Copy over the
    // portrait, at any scroll, sits on the gradient, the opaque panels or its own paper ground (css/main.css,
    // .portrait-bottom), which move with the text where this static rect cannot.
    const c = copy.getBoundingClientRect();
    const top = c.top - section.getBoundingClientRect().top;
    const height = next.mode === 'strip' ? c.height : Math.min(c.height, next.rect.y - top);
    const nextSafe = height > 0 ? { x: c.left, y: top, w: c.width, h: height } : null;
    const changed = next.mode !== mode || !sameRect(next.rect, rect) || !sameRect(nextSafe, safe);
    Object.assign(rect, next.rect);
    mode = next.mode;
    safe = nextSafe;
    section.classList.toggle('portrait-bottom', mode === 'bottom');
    return changed;
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
  const step = section?.querySelector('.hero-step');
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
    const layout = createLayout({ section, h1, copy });
    // Formation 0 (the noise the portrait denoises from) is framed into the same rect, so the face resolves in place.
    const pose = { roll: 0, rect: () => layout.rect };
    relayout = () => {
      if (!layout.measure()) return;
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
    document.fonts?.addEventListener('loadingdone', relayout);   // the name's width (and the strip) follow the fonts

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
 * under reduced motion); the HUD counts the denoise steps 01 → 50 with the time. The first scroll input
 * speeds the rest up ×6; until it reports 1 the engine holds the Hero → Encoder mix at 0 (resolver.applyEntrance).
 */
function playEntrance({ gsap, boundaries, reduced }, showStep) {
  const proxy = { mix: 0 };
  boundaries[0] = 0;
  const rush = () => {
    tween.timeScale(RUSH);
    stopListening();
  };
  const stopListening = () => SCROLL_INPUTS.forEach((type) => removeEventListener(type, rush));
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
  SCROLL_INPUTS.forEach((type) => addEventListener(type, rush, { passive: true }));
}
