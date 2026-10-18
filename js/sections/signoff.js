// The sign-off (spec §2.8, §4.2 row 7, §4.4): JULIAN drawn on an offscreen canvas, built as formation 7, and the
// page room it is framed into. followRect and unionRect are pure and Node-testable; init(ctx) touches the DOM and
// receives the engine through ctx (this module imports no CDN library).
import { mulberry32 } from '../engine/formations/common.js';
import { buildName } from '../engine/formations/name.js';
import { fontFacesDeclared } from '../ui/veil.js';

const WORD = 'JULIAN';
const FONT = '900 200px Archivo';
const FONT_STACK = `${FONT}, "Helvetica Neue", Arial, sans-serif`;
const PAD = 2;                         // px of clear canvas around the glyph bounds
const SEED = 0x4a55;
const LAST_BOUNDARY = 6;               // About → Sign-off (main.js BOUNDARIES)

/** `rect` moved down by `dy`, written into `out` when given. */
export function offsetRect(rect, dy, out = { x: 0, y: 0, w: 0, h: 0 }) {
  out.x = rect.x;
  out.y = rect.y + dy;
  out.w = rect.w;
  out.h = rect.h;
  return out;
}

/**
 * The slot's rect as the pose should read it, in CSS px of the viewport: `slot` is its rect measured with the
 * section's top at the viewport's top. While the section is still below that line (the morph is running; the last
 * boundary ends when the section's top arrives) the word holds there; past it the word rides with the page, so it
 * stays in its slot to the end of the scroll however tall the section grew.
 */
export const followRect = (slot, sectionTop, out) => offsetRect(slot, Math.min(0, sectionTop), out);

/** The smallest rect holding every non-empty rect given, or null if there is none. */
export function unionRect(rects) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    if (!r || !(r.w > 0 && r.h > 0)) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const sameRect = (a, b) => a === b || (Boolean(a && b) && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/**
 * JULIAN in ink on a transparent canvas cut tight to the glyphs, as ImageData (the formation's box is the whole
 * image). Drawn only once the face is in (spec §3.2); under a failed font it draws in the fallback, and the page
 * room follows whatever width that comes out at.
 */
export async function drawName() {
  // FontFaceSet.load rejects (NetworkError) when a declared face's file cannot be fetched; that is not fatal here.
  // The faces exist only once the non-blocking font stylesheets apply (veil.js fontFacesDeclared).
  await fontFacesDeclared();
  await document.fonts.load(FONT, WORD).catch(() => {});
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  // Setting `font` resets the stretch, and so does resizing the canvas: both go first, in this order.
  const setFont = () => {
    g.font = FONT_STACK;
    g.fontStretch = 'expanded';        // 125%
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
  };
  setFont();
  const m = g.measureText(WORD);
  canvas.width = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 2 * PAD;
  canvas.height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 2 * PAD;
  setFont();
  g.fillStyle = '#000';
  g.fillText(WORD, PAD + m.actualBoundingBoxLeft, PAD + m.actualBoundingBoxAscent);
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Reserves the word's room in the page, builds formation 7 and frames it into that room (84% of the width: 8% side
 * margins). Returns at once: the work that needs the engine and the font runs behind it, so it never holds up the
 * sections after this one (main.js awaits each init in turn). The room exists only while WebGL does; without an
 * engine it is taken out again.
 */
export async function init(ctx) {
  const section = document.getElementById('contact');
  const inner = section?.querySelector('.signoff-inner');
  if (!inner) return;
  const footer = document.querySelector('.site-footer');
  const canvas = document.getElementById('scene');

  const slot = document.createElement('div');
  slot.className = 'signoff-name';
  slot.setAttribute('aria-hidden', 'true');
  inner.append(slot);
  inner.classList.add('has-name');

  ctx.engineReady.then(async (engine) => {
    if (!engine) {
      slot.remove();
      inner.classList.remove('has-name');
      ctx.ScrollTrigger?.refresh();
      return;
    }

    const image = drawName();          // one drawing serves the room's aspect and the builder
    image.catch((err) => console.error('The name could not be drawn.', err));

    // The slot's rect and the text above it (the keep-out) with the section's top at the viewport's top.
    const held = { x: 0, y: 0, w: 0, h: 0 };
    const text = { x: 0, y: 0, w: 0, h: 0 };
    let rest = NaN;
    let pageTop = 0;                   // the section's top in page px, as of the last measure
    // What the pose and the keep-out read, where the section's top is `top` (the engine ignores an empty keep-out).
    // The engine keeps the keep-out object and reads it every frame, so it is handed over once and moved in place.
    const rect = { x: 0, y: 0, w: 0, h: 0 };
    const safe = { x: 0, y: 0, w: 0, h: 0 };
    const pose = { roll: 0, rect: () => rect };
    engine.setSafeRects({ 7: safe });
    const place = (top) => {
      followRect(held, top, rect);
      offsetRect(text, top, safe);
    };

    /**
     * Re-measures after a layout change (the resize, the fonts, the slot's new aspect: all end in a ScrollTrigger
     * refresh). The engine's density estimate is taken with the word at rest, where the page ends: the footer is
     * the last thing in the document, so the section's top ends at the viewport height less both heights.
     */
    function measure() {
      const top = section.getBoundingClientRect().top;
      pageTop = top + window.scrollY;
      const rel = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top - top, w: r.width, h: r.height };
      };
      const nextHeld = rel(slot);
      const nextText = unionRect([...inner.children].filter((el) => el !== slot).map(rel)) ?? text;
      const viewport = canvas?.clientHeight || innerHeight;
      const nextRest = viewport - section.getBoundingClientRect().height - (footer?.getBoundingClientRect().height ?? 0);
      if (sameRect(nextHeld, held) && sameRect(nextText, text) && nextRest === rest) return;
      Object.assign(held, nextHeld);
      Object.assign(text, nextText);
      rest = nextRest;
      place(rest);
      engine.setPose(7, pose);
    }

    // Every frame once the morph has begun (until then neither is read). The keep-out stays on the text as it
    // scrolls in; the word, held where it will rest, rides with the page only after the morph is done. The section's
    // top comes from the scroll and the offset measured at the last refresh, so a tick reads no layout.
    ctx.onTick(() => {
      if (ctx.boundaries[LAST_BOUNDARY] > 0) place(pageTop - window.scrollY);
    });
    ctx.ScrollTrigger?.addEventListener('refresh', measure);
    measure();

    engine.registerFormation(7, async () => buildName(ctx.tier.N, { image: await image, rng: mulberry32(SEED) }));

    try {
      const { width, height } = await image;
      slot.style.setProperty('--name-aspect', `${width} / ${height}`);
      if (ctx.ScrollTrigger) ctx.ScrollTrigger.refresh();   // the room changed height; this also measures
      else measure();
    } catch { /* logged above; the room keeps its default aspect and formation 7 stays the stand-in */ }
  }).catch((err) => console.error('Sign-off preparation failed.', err));
}
