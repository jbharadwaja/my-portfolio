// Experiments (spec §2.5, §5.2): the horizontal rail of eight cards, the clusters that ride above them, the cards'
// bar charts and count-ups, and the rail's keyboard, mouse-drag and touch behaviour. The geometry and chart helpers
// are pure and Node-testable; init(ctx) touches the DOM and receives gsap, ScrollTrigger, the scroll and the engine
// through ctx (this module imports no CDN library).
import { railScrollFor } from '../ui/scroll.js';
import { countUp } from '../ui/split.js';
import { isDrag } from '../ui/cursor.js';
import { frameDistance } from '../engine/framing.js';
import { mulberry32 } from '../engine/formations/common.js';
import { buildClusters, CLUSTERS, CLUSTER_BOX } from '../engine/formations/clusters.js';

const K = 4;                           // the clusters formation (spec §4.2)
const STEPS = CLUSTERS - 1;            // card i is centred at rail progress i/7
const STAGE_SCROLL = 0.65;             // page scroll per px of rail travel: the cards move ~1.5× the scroll speed
const BAND_Y = 0.22;                   // the clusters' band: 22% from the stage top
const BAND_H = 0.26;                   // the pose frames one blob into a band this share of the stage high …
const BLOB_W = 0.86;                   // … and this share of a card wide, centred on the screen
const MIN_DEPTH = 0.6;                 // the camera is this close to the clusters' plane (or past it): placement holds
const SEED = 0x4a42 + K;
const ENTER_X = 0.85;                  // a card has entered once its left edge passes 85% of the viewport's width …
const ENTER = `left ${ENTER_X * 100}%`;
const ENTER_Y = '85%';                 // … or, already in view at rail x 0, once its top passes 85% of the height
const SVG_NS = 'http://www.w3.org/2000/svg';
// Chart rows (CSS px): two-bar charts get taller bars; series charts put a caption line over their rows.
const PAIR = { row: 16, bar: 8 };
const SERIES = { caption: 14, row: 11, bar: 5 };
const LABEL_GAP = 6;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- geometry (pure)

/**
 * The rail at viewport width `vw` (spec §2.5): card width 32 / 40 / 56 / 84 vw (≥ 1280, 1024–1279, 768–1023,
 * < 768), gap max(2vw, 16px), inline padding that centres the first card, and the travel that centres the last.
 */
export function railGeometry(vw) {
  const share = vw >= 1280 ? 0.32 : vw >= 1024 ? 0.4 : vw >= 768 ? 0.56 : 0.84;
  const cardW = share * vw;
  const gap = Math.max(0.02 * vw, 16);
  return { cardW, gap, pad: vw / 2 - cardW / 2, travel: STEPS * (cardW + gap) };
}

/** The page scroll the rail takes beyond the stage's own 100svh (spec §5.2). */
export function stageScroll(travel) {
  return STAGE_SCROLL * travel;
}

/** The card centred at rail progress p (0..1). */
export function cardIndexAt(p) {
  return Math.round(STEPS * clamp(p, 0, 1));
}

/**
 * World x (relative to the screen centre's) under a card centre: `cardCentreCss` is the card's centre at rail x 0 in
 * CSS px of a viewport `vw` wide, `railX` the rail's current x, `halfWidthWorld` the world width from the centre to
 * the right edge on the clusters' plane.
 */
export function clusterWorldX(cardCentreCss, railX, vw, halfWidthWorld) {
  return (((cardCentreCss + railX) / vw) * 2 - 1) * halfWidthWorld;
}

/**
 * Whether a card whose box is `rect` (viewport px, `vw` wide) is on screen for its count-up: its left edge past 85%
 * of the width, its right edge not yet gone off the left (a jump into mid-rail leaves the cards before it there).
 */
export function shouldCount(rect, vw) {
  return rect.left < ENTER_X * vw && rect.right > 0;
}

// The live rail's card → page y, set by init once the rail's trigger exists.
let centreOnRail = null;

/**
 * The page y that brings rail card `card` to the centre (spec §5.4 railScrollFor over the rail trigger's range and
 * the rail's travel), measured when called: the rail's own keyboard focus and the console's `open <n>` both go there.
 * Without the live rail (no scroll libraries), the card's own place under the header.
 */
export function railPositionFor(card) {
  if (centreOnRail) return centreOnRail(card);
  const header = document.querySelector('.site-header')?.offsetHeight ?? 0;
  return card.getBoundingClientRect().top + window.scrollY - header;
}

// ---------------------------------------------------------------- charts (pure)

const decimalsOf = (text) => {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
};

// A data-series string's tokens: its strings (labels, flags) or its numbers, as written (plain decimals: an exponent
// would read as decimals). Each entry holds one number.
const SERIES_TOKEN = /"(?:[^"\\]|\\.)*"|(-?\d+(?:\.\d+)?)/g;
const writtenNumbers = (json) => [...json.matchAll(SERIES_TOKEN)].map((m) => m[1]).filter(Boolean);

/**
 * What a card's chart shows, from its data-* values (spec §2.5, Ruling R37): two bars from data-metric and
 * data-compare (the model's orange, the comparison's ink), or one bar per data-series entry (the chosen one orange).
 * The orange bar is the chart's one emphasis. Series values print with thousands separators and the most decimals
 * any of them is written with in data-series (JSON.parse would turn "2.0" into 2); the two bars print their
 * attributes as written. Null for a card with no chart.
 */
export function chartSpec({ metric, compare, series, seriesLabel = '', limit }) {
  let rows;
  if (series) {
    const entries = JSON.parse(series);
    const decimals = Math.max(0, ...writtenNumbers(series).map(decimalsOf));
    const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    rows = entries.map(([label, value, flag]) => ({ label, value, text: format.format(value), accent: flag === 'chosen' }));
  } else if (metric !== undefined && compare !== undefined) {
    rows = [
      { label: '', value: Number(metric), text: metric, accent: true },
      { label: '', value: Number(compare), text: compare, accent: false },
    ];
  } else {
    return null;
  }
  const limitValue = limit === undefined ? null : Number(limit);
  return {
    kind: series ? 'series' : 'pair',
    rows,
    max: Math.max(...rows.map((r) => r.value), limitValue ?? 0),
    limit: limitValue,
    label: series ? seriesLabel : '',
  };
}

// ---------------------------------------------------------------- charts (DOM)

function svg(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Draws `spec` as inline SVG at the slot's width, before the slot's "compared with" text: a bar per row, from 0, with
 * its value after it (series rows are named on the left). Text is ink (spec §3.1); widths are measured once the
 * texts are in the document, so a late font swap only needs a redraw.
 */
function drawChart(slot, spec) {
  slot.querySelector('.card-bars')?.remove();
  const width = Math.floor(slot.clientWidth);
  if (!spec || width <= 0) return;
  const series = spec.kind === 'series';
  const { row, bar } = series ? SERIES : PAIR;
  const top = series && spec.label ? SERIES.caption : 0;
  const height = top + spec.rows.length * row;
  const chart = svg('svg', { class: 'card-bars', width, height, viewBox: `0 0 ${width} ${height}` });
  if (series) {
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `${spec.label}: ${spec.rows.map((r) => `${r.label} ${r.text}`).join(', ')}`);
    if (spec.label) chart.append(svg('text', { class: 'caption', x: 0, y: SERIES.caption / 2 - 1 }, spec.label));
  } else {
    chart.setAttribute('aria-hidden', 'true');   // the headline metric and the compared-with text say it in words
  }
  const items = spec.rows.map((r, i) => {
    const mid = top + i * row + row / 2;
    const name = series ? svg('text', { class: 'name', y: mid, 'text-anchor': 'end' }, r.label) : null;
    const rect = svg('rect', { class: `bar${r.accent ? ' is-accent' : ''}`, y: mid - bar / 2, height: bar });
    const value = svg('text', { class: 'value', y: mid }, r.text);
    chart.append(...[name, rect, value].filter(Boolean));
    return { r, name, rect, value };
  });
  slot.prepend(chart);
  const longest = (key) => Math.max(0, ...items.map((it) => it[key]?.getComputedTextLength() ?? 0));
  const nameW = series ? Math.ceil(longest('name')) : 0;
  const x0 = series ? nameW + LABEL_GAP : 0;
  const span = Math.max(1, width - x0 - LABEL_GAP - Math.ceil(longest('value')));
  const scale = spec.max > 0 ? span / spec.max : 0;
  for (const { r, name, rect, value } of items) {
    const w = Math.max(1, r.value * scale);
    name?.setAttribute('x', nameW);
    rect.setAttribute('x', x0);
    rect.setAttribute('width', w);
    value.setAttribute('x', x0 + w + LABEL_GAP);
  }
  if (spec.limit !== null) {
    const x = Math.round(x0 + spec.limit * scale) + 0.5;   // a crisp 1 px hairline
    chart.append(svg('line', { class: 'limit', x1: x, x2: x, y1: top, y2: height }));
  }
}

// ---------------------------------------------------------------- init

/**
 * Wires the rail (spec §2.5, §5.2): #work's length from the rail travel, the scrubbed rail tween, count-ups as the
 * cards enter, the charts, hover/focus highlighting, focus scrolling, ←/→, mouse drag and the touch hint. With the
 * engine (it may never come: the rail works without it) the clusters formation is registered and placed every
 * frame. Nothing here waits for the engine, so the sections after this one are not held up.
 */
export async function init(ctx) {
  const section = document.getElementById('work');
  const stage = section?.querySelector('.stage');
  const viewport = section?.querySelector('.rail-viewport');
  const rail = viewport?.querySelector('.rail');
  const cards = rail ? [...rail.querySelectorAll('.card')] : [];
  if (!stage || !rail || cards.length !== CLUSTERS) return;
  const { gsap, ScrollTrigger, scroll } = ctx;
  const head = section.querySelector('.section-head');
  const below = [section.querySelector('.rail-more'), section.querySelector('.rail-hint')].filter(Boolean);
  const hint = section.querySelector('.rail-hint');
  const hintText = hint?.textContent ?? '';
  const charts = cards.map((card) => ({ slot: card.querySelector('.card-chart'), spec: chartSpec(card.dataset) }))
    .filter(({ slot, spec }) => slot && spec);
  const coarse = matchMedia('(pointer: coarse)');

  // Measured at every ScrollTrigger refresh (and read every frame): the viewport, the stage, the cards' centres at
  // rail x 0, the pose's band rect and the keep-out rects (stage-relative, as laid out while the stage is held).
  const layout = {
    vw: 1, stageH: 1, start: 0, end: 0, stickyEnd: 0, origin: 0,
    centres: new Float32Array(CLUSTERS),
    band: { x: 0, y: 0, w: 0, h: 0 },
    safe: [null, null],
  };
  let travel = 0;
  let engine = null;

  // The section's length follows the rail travel; set before any trigger measures, so the boundaries after the
  // rail (B4–B6) and the rail's own trigger see the final height (spec §5.2).
  const sizeSection = () => {
    travel = railGeometry(innerWidth).travel;   // vw units and media queries are both innerWidth-based
    section.style.height = `calc(100svh + ${stageScroll(travel)}px)`;
  };
  section.classList.add('rail-on');
  sizeSection();
  ScrollTrigger.addEventListener('refreshInit', sizeSection);

  let shownCard = -1;
  const showProgress = (p) => {
    const i = cardIndexAt(p);
    if (i === shownCard || !hint) return;
    shownCard = i;
    hint.textContent = hintText.replace(/\d+(?= \/ \d)/, String(i + 1).padStart(2, '0'));
  };

  const tween = gsap.to(rail, {
    x: () => -travel,
    ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      scrub: scroll.lenis ? true : 0.3,   // Lenis already smooths (spec §5.1)
      invalidateOnRefresh: true,
      onUpdate: (self) => showProgress(self.progress),
    },
  });
  const st = tween.scrollTrigger;
  const railX = () => gsap.getProperty(rail, 'x');
  centreOnRail = (card) => railScrollFor({
    stStart: st.start,
    stEnd: st.end,
    cardLeft: viewport.getBoundingClientRect().left + card.offsetLeft,
    cardWidth: card.offsetWidth,
    innerWidth: document.documentElement.clientWidth,
    railTravel: travel,
  });

  // Count-ups (spec §3.3): once per card, the first time it enters (Ruling R33). A card enters sideways through
  // the rail (containerAnimation) — except the ones already in view at rail x 0, which enter upward with the stage:
  // their sideways trigger would only fire once the rail moves, after they had been read at their final value. A
  // jump straight into mid-rail passes the cards before it: those are off screen and keep their final value.
  const values = cards.map((card) => card.querySelector('.card-metric-value'));
  const counted = new Set();
  const enter = (i) => {
    if (!values[i] || counted.has(i)) return;
    counted.add(i);
    countUp(values[i], gsap);
  };
  cards.forEach((card, i) => {
    if (!values[i]) return;
    ScrollTrigger.create({
      trigger: card,
      containerAnimation: tween,
      start: ENTER,
      onEnter: (self) => {
        const seen = self.isActive;      // false when a jump has carried the card straight past (off the left)
        self.kill();
        if (seen) enter(i);
      },
    });
  });
  ScrollTrigger.create({
    trigger: section,                  // not the sticky stage: its offset in the section holds at any scroll
    start: () => `top+=${viewport.offsetTop} ${ENTER_Y}`,
    onEnter: (self) => {
      self.kill();
      const vw = document.documentElement.clientWidth;
      cards.forEach((card, i) => { if (shouldCount(card.getBoundingClientRect(), vw)) enter(i); });
    },
  });

  // ---- hover and focus → the highlighted cluster (spec §2.5); on coarse pointers the card at the centre

  let pointerCard = -1;
  let focusCard = -1;
  cards.forEach((card, i) => {
    card.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') pointerCard = i; });
    card.addEventListener('pointerleave', () => { if (pointerCard === i) pointerCard = -1; });
  });
  const hovered = () => (coarse.matches ? cardIndexAt(st.progress) : pointerCard >= 0 ? pointerCard : focusCard);

  // ---- keyboard: focus brings its card to the centre through page scroll; ←/→ step between cards

  // Keyboard focus only: a mouse press focuses its card too, and that must neither glide the rail under a drag nor
  // keep the cluster lit once the pointer has left (the hover already lit it).
  const fromKeyboard = (el) => {
    try {
      return el.matches(':focus-visible');
    } catch {
      return true;
    }
  };
  rail.addEventListener('focusin', (e) => {
    const i = cards.indexOf(e.target.closest('.card'));
    focusCard = i >= 0 && fromKeyboard(e.target) ? i : -1;
    if (focusCard >= 0) scroll.scrollTo(railPositionFor(cards[focusCard]));
  });
  rail.addEventListener('focusout', () => { focusCard = -1; });
  rail.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const i = cards.indexOf(e.target.closest('.card'));
    const next = cards[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (i < 0 || !next) return;
    e.preventDefault();
    next.focus({ preventScroll: true });
  });

  // ---- mouse drag (spec §6.3): after 6 px the rail pans with the pointer, 1 px = (end − start)/travel px of scroll

  let press = null;
  let swallowClick = false;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) press = { id: e.pointerId, x: e.clientX, y: e.clientY, from: 0, dragging: false };
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging) {
      if (!(e.buttons & 1)) {            // released outside the rail before the drag began
        press = null;
        return;
      }
      if (!isDrag(Math.hypot(e.clientX - press.x, e.clientY - press.y))) return;
      press.dragging = true;
      press.from = window.scrollY;
      viewport.setPointerCapture(e.pointerId);
      rail.classList.add('is-dragging');
      getSelection()?.removeAllRanges();
    }
    // Kept to the rail's stretch of the page, or to where the drag began if that was outside it (a press while the
    // stage scrolls in must not jump the page to the rail's start).
    const perPx = travel > 0 ? (st.end - st.start) / travel : 0;
    const y = press.from - (e.clientX - press.x) * perPx;
    scroll.scrollTo(clamp(y, Math.min(press.from, st.start), Math.max(press.from, st.end)), { immediate: true });
  });
  const release = (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.dragging) {
      rail.classList.remove('is-dragging');
      swallowClick = true;             // the click this release is about to fire (on a link, a card) is not a click
      setTimeout(() => { swallowClick = false; }, 0);
    }
    press = null;
  };
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);
  viewport.addEventListener('lostpointercapture', release);
  viewport.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  viewport.addEventListener('dragstart', (e) => e.preventDefault());   // no native link drag in place of the pan

  // ---- clusters (spec §2.5): placed above their cards every frame, from the current camera

  const clusterX = new Float32Array(CLUSTERS);
  const hit = { x: 0, y: 0 };
  const pose = { lookAt: [0, 0, 0], roll: 0, rect: () => layout.band, box: CLUSTER_BOX };

  /** The stage's top on screen: below the fold before the section is reached, 0 while held, above it after. */
  const stageTop = () => {
    const y = window.scrollY;
    if (y < layout.start) return layout.start - y;
    return y > layout.stickyEnd ? layout.stickyEnd - y : 0;
  };

  function placeClusters() {
    const { uniforms, pair } = engine.state;
    uniforms.uHoverCluster = hovered();
    if (pair.from !== K && pair.to !== K) return;
    if (engine.camera.position.z + K * engine.D < MIN_DEPTH) return;
    // Each cluster goes to the point of the clusters' plane under its card's centre on the band, unprojected through
    // this frame's camera (Ruling R7's unproject, taken per card): the pointer parallax turns the camera, which makes
    // the screen-to-plane map projective, so one half-width scaled linearly (clusterWorldX) drifts up to ~19 px at
    // 1440 while this stays exact. Without parallax both agree (the density estimate below uses clusterWorldX).
    const bandY = stageTop() + BAND_Y * layout.stageH;
    const x = railX();
    for (let id = 0; id < CLUSTERS; id++) clusterX[id] = engine.unproject(K, layout.centres[id] + x, bandY, hit).x;
    uniforms.uClusterY = engine.unproject(K, layout.vw / 2, bandY, hit).y;
  }

  // The density estimate (Ruling R44) sees the blobs where the held pose places them, not stacked at the origin:
  // band centre at world (0, 0), each blob over its card at the rail's current x.
  const heldX = new Float32Array(CLUSTERS);
  let placed = null;
  function placedForDensity(data) {
    if (placed?.length !== data.length) placed = new Float32Array(data.length);   // a rebuild at another N
    const canvas = engine.renderer.domElement;
    const vh = canvas.clientHeight || innerHeight;
    const fov = engine.camera.fov;
    const worldPerPx = (2 * frameDistance(CLUSTER_BOX, layout.band, layout.vw, vh, fov) * Math.tan((fov * Math.PI) / 360)) / vh;
    const x = railX();
    const half = (layout.vw / 2) * worldPerPx;
    for (let id = 0; id < CLUSTERS; id++) heldX[id] = clusterWorldX(layout.centres[id], x, layout.vw, half);
    placed.set(data);
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 0) placed[i] += heldX[data[i + 3]];
    return placed;
  }

  function attachEngine(e) {
    engine = e;
    const { uniforms } = engine.state;
    uniforms.uClusterX = clusterX;
    uniforms.uClusterY = 0;
    uniforms.uHoverCluster = -1;
    engine.setPose(K, pose);
    engine.setSafeRects({ [K]: layout.safe });
    engine.registerFormation(K, () => {
      const formation = buildClusters(ctx.tier.N, { rng: mulberry32(SEED) });
      formation.densityData = () => placedForDensity(formation.data);
      return formation;
    });
    engine.onFrame(placeClusters);
  }

  // ---- layout, at every refresh

  // The head's keep-out comes from its blocks (h2, subtitle), not from the glyphs' own boxes: until a split reveal
  // plays, its letters and words sit 0.35em low (and narrow, under --wdth), and the refresh measures before then.
  // A block's box is its layout, which those transforms never move; the screen-reader copy inside adds nothing.
  function keepOut(boxes, stageBox) {
    const shown = boxes.filter((b) => b.width > 0 && b.height > 0);
    if (shown.length === 0) return null;
    const x0 = Math.min(...shown.map((b) => b.left));
    const y0 = Math.min(...shown.map((b) => b.top));
    const x1 = Math.max(...shown.map((b) => b.right));
    const y1 = Math.max(...shown.map((b) => b.bottom));
    return { x: x0 - stageBox.left, y: y0 - stageBox.top, w: x1 - x0, h: y1 - y0 };
  }

  // The viewport and the cards' centres at rail x 0. Also read on every resize: the cards resize with the viewport at
  // once, while the refresh that re-measures the rest comes ~200 ms later, and the clusters would lag their cards.
  function readCentres() {
    layout.vw = document.documentElement.clientWidth;
    layout.origin = viewport.getBoundingClientRect().left;
    cards.forEach((card, i) => { layout.centres[i] = layout.origin + card.offsetLeft + card.offsetWidth / 2; });
  }

  function measure() {
    // The charts first: they set the cards' height, and on a short stage that moves the head (align-content: end).
    for (const { slot, spec } of charts) drawChart(slot, spec);
    rail.style.removeProperty('--chart-h');
    const chartH = Math.max(...cards.map((card) => card.querySelector('.card-chart')?.offsetHeight ?? 0));
    rail.style.setProperty('--chart-h', `${chartH}px`);
    readCentres();
    layout.stageH = stage.offsetHeight;
    layout.start = st.start;
    layout.end = st.end;
    layout.stickyEnd = st.start + section.offsetHeight - layout.stageH;
    const band = layout.band;
    band.w = BLOB_W * cards[0].offsetWidth;
    band.h = BAND_H * layout.stageH;
    band.x = (layout.vw - band.w) / 2;
    band.y = BAND_Y * layout.stageH - band.h / 2;
    const stageBox = stage.getBoundingClientRect();
    const headBlocks = head ? [...head.children].map((el) => el.getBoundingClientRect()) : [];
    layout.safe = [keepOut(headBlocks, stageBox), keepOut(below.map((el) => el.getBoundingClientRect()), stageBox)];
    showProgress(st.progress);
    if (engine) {
      engine.setSafeRects({ [K]: layout.safe });
      engine.setPose(K, pose);         // re-runs the clusters' density estimate at the new layout
    }
  }
  ScrollTrigger.addEventListener('refresh', measure);
  addEventListener('resize', readCentres);
  measure();

  ctx.engineReady.then((e) => {
    if (!e) return;
    attachEngine(e);
    measure();
  }).catch((err) => console.error('Experiments: clusters unavailable.', err));
}
