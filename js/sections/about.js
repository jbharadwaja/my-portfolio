// About (spec §2.7; formation 6, the galaxy, spec §4.2): the halftone reveal of the full photo, and the galaxy's
// pose behind the plate. The photo's <img> stays lazy and is never awaited at boot (Ruling R18): the reveal starts
// (the image loads, is sampled and its halftone pre-rendered) once About is within 2 screens. A fine pointer wipes
// the dots; on touch (hover: none) one slow automatic sweep plays as the plate comes into view (none under reduced
// motion, spec §3.3) and taps wipe them too. The caption's hint shows once the reveal is live
// (css/sections/about.css).
import { createHalftoneReveal } from '../ui/halftone-reveal.js';

const NEAR = '200% 0px';               // About within 2 screens of the viewport
const RESIZE_DEBOUNCE_MS = 150;
const GALAXY = 6;
const HALO = { w: 2.2, h: 1.3 };       // the galaxy's frame around the plate, in plate sizes

export async function init(ctx) {
  const section = document.getElementById('about');
  const figure = section?.querySelector('.plate-figure');
  const plate = figure?.querySelector('.plate');
  const canvas = plate?.querySelector('.plate-canvas');
  const img = plate?.querySelector('.plate-img');
  if (!canvas || !img) return;

  const touch = matchMedia('(hover: none)').matches;
  const reveal = createHalftoneReveal({ canvas, img, interactive: true, autoSweep: touch && !ctx.reduced });
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    reveal.start().then((live) => figure.classList.toggle('is-live', live));
  }, { rootMargin: NEAR });
  near.observe(section);

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => reveal.resize(), RESIZE_DEBOUNCE_MS);
  });

  // Not awaited: the engine may still be loading (or absent), and the reveal does not depend on it.
  Promise.resolve(ctx.engineReady).then((engine) => {
    if (!engine) return;
    placeGalaxy(engine, ctx.ScrollTrigger, {
      section,
      plate,
      keepOut: [section.querySelector('.about-text'), figure.querySelector('.plate-caption')],
    });
  }).catch((err) => console.error('About: the galaxy pose could not be set.', err));
}

/**
 * Formation 6 is framed into the plate's rect grown by HALO about its centre, as the plate sits once About's top
 * meets the viewport's top (where 6 is held): the spiral's dense core sits behind the opaque photo and its arms
 * reach out around it. About is not a sticky stage, so its copy scrolls through the held galaxy: the text keep-out
 * (spec §4.5) follows the copy and the caption. Their page offsets are measured at every ScrollTrigger refresh;
 * each frame only subtracts the scroll position (no layout reads, no allocations).
 */
function placeGalaxy(engine, ScrollTrigger, { section, plate, keepOut }) {
  const frame = { x: 0, y: 0, w: 0, h: 0 };
  const pose = { rect: () => frame };
  const rects = keepOut.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const pageY = keepOut.map(() => 0);

  function measure() {
    const scrollY = window.scrollY;
    const p = plate.getBoundingClientRect();
    const w = Math.round(p.width * HALO.w);
    const h = Math.round(p.height * HALO.h);
    const x = Math.round(p.left + p.width / 2 - w / 2);
    const y = Math.round(p.top - section.getBoundingClientRect().top + p.height / 2 - h / 2);
    if (x !== frame.x || y !== frame.y || w !== frame.w || h !== frame.h) {
      Object.assign(frame, { x, y, w, h });
      engine.setPose(GALAXY, pose);    // re-runs the galaxy's density estimate at the new framing
    }
    keepOut.forEach((el, i) => {
      const r = el?.getBoundingClientRect();
      rects[i].x = r?.left ?? 0;
      rects[i].w = r?.width ?? 0;
      rects[i].h = r?.height ?? 0;
      pageY[i] = (r?.top ?? 0) + scrollY;
    });
    follow();
  }

  function follow() {
    const scrollY = window.scrollY;
    for (let i = 0; i < rects.length; i++) rects[i].y = pageY[i] - scrollY;
  }

  engine.setSafeRects({ [GALAXY]: rects });   // the engine keeps these objects and reads them every frame
  measure();
  ScrollTrigger?.addEventListener('refresh', measure);
  engine.onFrame(() => {
    const { from, to } = engine.state.pair;
    if (from === GALAXY || to === GALAXY) follow();
  });
}
