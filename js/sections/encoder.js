// The encoder (spec §2.3, §5.2, §8.4): the network formation (2) framed into the stage below the section's text,
// the activation pulse (uPulse) scrubbed over the sticky stage, and the 19 DOM labels pinned to the projected nodes
// every rendered frame (a label that would cover the text block or the HUD's corner fades out until it clears).
// activeLayer is pure and Node-testable; init(ctx) touches the DOM and receives gsap, ScrollTrigger and the engine
// through ctx (this module imports no CDN library). Without the engine the labels keep their static layer grid
// (css/main.css).
import { veil } from '../ui/veil.js';
import { frameDistance } from '../engine/framing.js';
import { mulberry32 } from '../engine/formations/common.js';
import { NETWORK_LAYERS, networkNodes, networkBox, buildNetwork } from '../engine/formations/network.js';

const K = 2;                           // the network's formation index (spec §4.2)
const OUTPUT = NETWORK_LAYERS.length - 1;
const SEED = 0x4e4554;
const VERTICAL_BELOW = 0.8;            // stage aspect under which the network runs top to bottom (spec §2.3)
const WIDE = 768;                      // narrower, only the input and output labels show (spec §2.3)
const LABEL_GAP = 8;                   // px from a node's edge to its label (spec §2.3)
const HALO = 3;                        // px of paper around each label (css/sections/encoder.css)
// px from the text block (h2 + body) down to the network's nodes: past the keep-out's 32 px feather. Labels may come
// closer, down to LABEL_HEAD_GAP.
const HEAD_GAP = 40;
const LABEL_HEAD_GAP = 24;
const BOTTOM = 32;                     // px kept free at the stage's bottom
const HUD = { w: 210, h: 70 };         // from 768 px up the section HUD holds the bottom-left corner (Ruling R54)
const MIN_REGION = 0.25;               // a region below the text shorter than this share of the stage: bottom half
const FORMED = { from: 0.8, to: 1 };   // the labels fade in over the last fifth of the morph onto the network
const RESIZE_DEBOUNCE_MS = 150;
// Where each label sits against its node point (the gap is already in that point), as a transform suffix.
const ANCHOR = {
  left: ' translate(-100%, -50%)',     // inputs: right-aligned, to the left of the node
  right: ' translate(0, -50%)',        // outputs, and every label of the vertical network
  above: ' translate(-50%, -100%)',    // hidden layers: centred above
};

/** The active layer: the highest k with pulse ≥ k/3, so the inputs are active at 0 (spec §2.3). */
export function activeLayer(pulse) {
  for (let k = OUTPUT; k > 0; k--) if (pulse >= k / OUTPUT) return k;
  return 0;
}

const anchorOf = (layer, vertical) => {
  if (vertical || layer === OUTPUT) return 'right';
  return layer === 0 ? 'left' : 'above';
};

const roundRect = ({ x, y, w, h }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
const sameRect = (a, b) => Boolean(a && b) && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** CSS px per world unit of a box framed into `rect` (framing.js; the field of view cancels out). */
const pxPerUnit = (box, rect, vw, vh) => vh / (2 * frameDistance(box, rect, vw, vh, 90));

/**
 * The network's box framed into `rect` (the camera puts the box centre on the rect centre): its scale, centre and
 * every label's box in CSS px, halo included. `items` = [{ node, anchor, w, h }].
 */
function frame(rect, box, items, vw, vh) {
  const s = pxPerUnit(box, rect, vw, vh);
  const ox = rect.x + rect.w / 2;
  const oy = rect.y + rect.h / 2;
  const labels = items.map(({ node, anchor, w, h }) => {
    const cx = ox + node.x * s;
    const cy = oy - node.y * s;
    const g = node.r * s + LABEL_GAP;
    const x = anchor === 'left' ? cx - g - w : anchor === 'right' ? cx + g : cx - w / 2;
    const y = anchor === 'above' ? cy - g - h : cy - h / 2;
    return { x0: x - HALO, y0: y - HALO, x1: x + w + HALO, y1: y + h + HALO };
  });
  return { s, ox, oy, labels };
}

/**
 * The rect the network's box is framed into: `region` minus room for the labels that can show, so every label stays
 * inside the region, with the nodes at least `nodesFrom` px below the region's top. A label's overflow past the box
 * depends on the scale, which depends on the rect, so it is solved in a few passes.
 */
function insetRect(region, box, items, vw, vh, nodesFrom) {
  let rect = region;
  for (let pass = 0; pass < 3; pass++) {
    const { s, ox, oy, labels } = frame(rect, box, items, vw, vh);
    const bw = (box.w * s) / 2;
    const bh = (box.h * s) / 2;
    let l = 0;
    let r = 0;
    let t = nodesFrom;
    let b = 0;
    for (const { x0, y0, x1, y1 } of labels) {
      l = Math.max(l, ox - bw - x0);
      r = Math.max(r, x1 - (ox + bw));
      t = Math.max(t, oy - bh - y0);
      b = Math.max(b, y1 - (oy + bh));
    }
    rect = { x: region.x + l, y: region.y + t, w: Math.max(1, region.w - l - r), h: Math.max(1, region.h - t - b) };
  }
  return rect;
}

/** insetRect, with the region's bottom raised until no label reaches into the HUD's corner (when `hud`). */
function networkRect(region, box, items, vw, vh, { nodesFrom, hud }) {
  let rect = insetRect(region, box, items, vw, vh, nodesFrom);
  for (let pass = 0; hud && pass < 4; pass++) {
    const zone = vh - hud.h;
    const over = frame(rect, box, items, vw, vh).labels.reduce((m, l) => (l.x0 < hud.w ? Math.max(m, l.y1 - zone) : m), 0);
    if (over <= 0) break;
    region = { ...region, h: region.h - over };
    rect = insetRect(region, box, items, vw, vh, nodesFrom);
  }
  return roundRect(rect);
}

/**
 * Measures the stage as laid out while it is held (its top at the viewport's top), and what the per-frame guard
 * needs: each label's size, the section's place in the document and the HUD's corner.
 */
function measureLayout({ section, stage, head, labels, nodeOf }) {
  const vw = document.documentElement.clientWidth;
  const st = stage.getBoundingClientRect();
  const vh = st.height || innerHeight;
  const hd = head.getBoundingClientRect();
  const sc = section.getBoundingClientRect();
  const gutter = parseFloat(getComputedStyle(stage).paddingLeft) || 0;
  const vertical = vw / vh < VERTICAL_BELOW;
  const wide = vw >= WIDE;
  const nodes = networkNodes({ vertical });
  const box = networkBox(nodes);
  // The text block keeps particles out (spec §4.5); the network goes below it.
  const safe = roundRect({ x: hd.left - st.left, y: hd.top - st.top, w: hd.width, h: hd.height });
  const bottom = vh - BOTTOM;
  const top = safe.y + safe.h + LABEL_HEAD_GAP;
  const below = bottom - top >= MIN_REGION * vh;
  const region = below
    ? { x: gutter, y: top, w: vw - 2 * gutter, h: bottom - top }
    : { x: gutter, y: vh / 2, w: vw - 2 * gutter, h: bottom - vh / 2 };
  const anchors = labels.map((el, i) => anchorOf(nodes[nodeOf[i]].layer, vertical));
  const sizes = labels.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
  const items = [];
  labels.forEach((el, i) => {
    const node = nodes[nodeOf[i]];
    if (wide || node.layer === 0 || node.layer === OUTPUT) items.push({ node, anchor: anchors[i], ...sizes[i] });
  });
  const rect = networkRect(region, box, items, vw, vh, { nodesFrom: below ? HEAD_GAP - LABEL_HEAD_GAP : 0, hud: wide && HUD });
  const viewH = document.documentElement.clientHeight;   // the fixed HUD sits on the viewport's bottom edge
  return {
    vertical, nodes, box, anchors, sizes, safe, rect,
    text: { x0: safe.x, y0: safe.y, x1: safe.x + safe.w, y1: safe.y + safe.h },   // stage px
    section: { top: sc.top + scrollY, h: sc.height, stageH: vh },
    hud: wide ? { x0: 0, y0: viewH - HUD.h, x1: HUD.w, y1: viewH } : null,
  };
}

/** The stage's top in the viewport: the section's top until it sticks, 0 while held, then rising with the section's end. */
function stageTop({ top, h, stageH }) {
  const y = top - scrollY;
  return y > 0 ? y : Math.min(0, y + h - stageH);
}

const hits = (x0, y0, x1, y1, r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0;

/**
 * uPulse runs 0 → 1 over the sticky stage (spec §5.1: measured, scrub: true; 0.3 when Lenis is off), and sets
 * which layer's labels show.
 */
function createPulse({ gsap, scroll }, section, setPulse) {
  const proxy = { pulse: 0 };
  gsap.to(proxy, {
    pulse: 1,
    ease: 'none',
    onUpdate: () => setPulse(proxy.pulse),
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: scroll?.lenis ? true : 0.3 },
  });
}

/**
 * Registers the network (it builds after the veil, in an idle task), frames it below the text, keeps particles off
 * the text and pins the labels to the projected nodes on every rendered frame. Re-measured on resize, late fonts and
 * ScrollTrigger refreshes; an aspect-class change rebuilds the formation (spec §4.8).
 */
function goLive({ ctx, engine, section, stage, head, container, labels, nodeOf }) {
  section.classList.add('net-live');
  container.style.opacity = '0';
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  const pose = { lookAt: [0, 0, 0], roll: 0, rect: () => rect, box: null };
  let layout = null;
  let safe = null;
  let lifted = false;

  const last = new Float64Array(labels.length * 2);
  const forget = () => last.fill(NaN);
  forget();

  function relayout() {
    const next = measureLayout({ section, stage, head, labels, nodeOf });
    const rebuild = next.vertical !== layout?.vertical;
    layout = next;
    if (rebuild || !sameRect(next.rect, rect)) {
      Object.assign(rect, next.rect);
      pose.box = next.box;
      engine.setPose(K, pose);         // re-runs the built formation's density estimate at the new framing
    }
    if (rebuild) {
      engine.registerFormation(K, () => buildNetwork(ctx.tier.N, { vertical: next.vertical, rng: mulberry32(SEED) }));
      // After the veil the network on screen follows at once; before it, it builds with the others (spec §4.2).
      if (lifted) engine.ensure(K).catch(() => {});   // a failed build is logged by the engine
      forget();
    }
    if (!sameRect(next.safe, safe)) {
      safe = next.safe;
      engine.setSafeRects({ [K]: safe });
    }
  }
  relayout();

  veil.onLift(() => {
    lifted = true;
    relayout();
  });
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, RESIZE_DEBOUNCE_MS);
  });
  document.fonts?.addEventListener('loadingdone', relayout);   // the text block's height and the labels' widths
  document.fonts?.ready.then(relayout);
  ctx.ScrollTrigger?.addEventListener('refresh', relayout);

  const world = [0, 0, 0];
  const centre = { x: 0, y: 0 };
  const edge = { x: 0, y: 0 };
  const blocked = new Uint8Array(labels.length);
  let shown = -1;
  engine.onFrame(() => {
    // The labels show while the particles are (nearly) on the network, and dip with them.
    const { from, to, mix } = engine.state.pair;
    const formed = Math.max(from === K ? 1 - mix : 0, to === K ? mix : 0);
    const opacity = Math.round(smoothstep(FORMED.from, FORMED.to, formed) * engine.particles.uniforms.uOpacity.value * 1000) / 1000;
    if (opacity !== shown) {
      shown = opacity;
      container.style.opacity = String(opacity);
    }
    if (opacity === 0) return;
    const z = -K * engine.D;
    // The guard: the layout keeps every label off the text block and the HUD's corner, but pointer parallax (±2.5°,
    // spec §4.4) on a short stage, or a stage too short for the network below its text (a landscape phone), can still
    // put one there. A label that would cover either fades out until it clears. The text block scrolls with the stage.
    const dy = stageTop(layout.section);
    const { text, hud } = layout;
    for (let i = 0; i < labels.length; i++) {
      const node = layout.nodes[nodeOf[i]];
      world[0] = node.x;
      world[1] = node.y;
      world[2] = node.z + z;
      engine.project(world, centre);
      world[0] = node.x + node.r;
      engine.project(world, edge);
      const gap = Math.hypot(edge.x - centre.x, edge.y - centre.y) + LABEL_GAP;
      const anchor = layout.anchors[i];
      const x = Math.round((anchor === 'left' ? centre.x - gap : anchor === 'right' ? centre.x + gap : centre.x) * 100) / 100;
      const y = Math.round((anchor === 'above' ? centre.y - gap : centre.y) * 100) / 100;
      const { w, h } = layout.sizes[i];
      const x0 = (anchor === 'left' ? x - w : anchor === 'right' ? x : x - w / 2) - HALO;
      const y0 = (anchor === 'above' ? y - h : y - h / 2) - HALO;
      const x1 = x0 + w + 2 * HALO;
      const y1 = y0 + h + 2 * HALO;
      const over = Number(hits(x0, y0 - dy, x1, y1 - dy, text) || (hud !== null && hits(x0, y0, x1, y1, hud)));
      if (over !== blocked[i]) {
        blocked[i] = over;
        labels[i].toggleAttribute('data-blocked', over === 1);   // css/sections/encoder.css fades it out
      }
      if (x === last[i * 2] && y === last[i * 2 + 1]) continue;
      last[i * 2] = x;
      last[i * 2 + 1] = y;
      labels[i].style.transform = `translate(${x}px, ${y}px)${ANCHOR[anchor]}`;
    }
  });
}

export async function init(ctx) {
  const section = document.getElementById('encoder');
  const stage = section?.querySelector('.stage');
  const head = section?.querySelector('.section-head');
  const container = section?.querySelector('.net-labels');
  const labels = container ? [...container.querySelectorAll('.net-label')] : [];
  if (!stage || !head || labels.length === 0) return;
  // Each label's node: nodes run layer by layer (networkNodes), so a node's index is its layer's offset + its own.
  const offsets = NETWORK_LAYERS.map((_, l) => NETWORK_LAYERS.slice(0, l).reduce((a, b) => a + b, 0));
  const nodeOf = labels.map((el) => offsets[Number(el.dataset.layer)] + Number(el.dataset.node));

  let engine = null;
  let pulse = 0;
  let active = -1;
  const setPulse = (value) => {
    pulse = value;
    if (engine) engine.state.uniforms.uPulse = pulse;
    const layer = activeLayer(pulse);
    if (layer === active) return;
    active = layer;
    container.dataset.active = String(layer);   // css/sections/encoder.css shows its labels and the outputs
  };
  setPulse(0);
  if (ctx.gsap && ctx.ScrollTrigger) createPulse(ctx, section, setPulse);

  // Not awaited: the sections after this one initialise while three is still loading.
  ctx.engineReady.then((ready) => {
    if (!ready) return;
    engine = ready;
    engine.state.uniforms.uPulse = pulse;
    try {
      goLive({ ctx, engine, section, stage, head, container, labels, nodeOf });
    } catch (err) {
      // A failed setup (its first measure) leaves the labels hidden in their live style: the static grid comes back.
      section.classList.remove('net-live');
      container.style.removeProperty('opacity');
      throw err;
    }
  }).catch((err) => console.error('Encoder network setup failed.', err));
}
