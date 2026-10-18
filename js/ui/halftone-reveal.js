// The halftone photo reveal (spec §2.7). A canvas laid over an <img> shows the photo as ink dots on paper; the
// pointer wipes the dots away along its recent path to uncover the full-colour photo, and the wipe heals over ~1 s.
// Layers, sized once and again on resize(): the halftone (dots pre-rendered), the photo (scaled to the canvas),
// a mask at 1/4 resolution holding the wipe, and a scratch canvas where halftone minus mask is composed before it
// is drawn over the photo. Each frame heals the mask, stamps the pointer's latest segment as soft radial brushes
// whose radius follows 1-D noise over time (the crawling edge), and composes. There is no per-pixel work and no
// getImageData after the luminance is sampled once (luminanceField; a cut-out's transparent ground gets no dots).
// The loop runs only while the canvas is in view and the pointer moved in the last 1.2 s or the mask still holds a
// wipe (shouldRun); otherwise it sleeps.
// Generic: About uses it interactive (plus one automatic sweep on touch); the no-WebGL hero uses it static.
// dotRadius, healAlpha, shouldRun and luminanceField are pure; nothing here touches the DOM until
// createHalftoneReveal is called.

const MAX_DPR = 1.5;
const HEAL_S = 0.35;                   // the heal's time constant: a wipe is ~5% left after 1 s
const POINTER_WINDOW_MS = 1200;        // the loop keeps running this long after the last pointer move
const MAX_DT = 1 / 30;                 // integrators never step more than this (spec §4.7)
const MASK_SCALE = 4;                  // the mask is 1/4 of the canvas resolution
// Below this the mask's strongest pixel is cleared outright: an 8-bit canvas faded by a few % a frame stops
// decreasing at low alpha, so it would never reach empty on its own (and the loop would never sleep).
const EMPTY = 0.04;
const CELL = { share: 1 / 72, min: 4.5, max: 8 };   // dot pitch in CSS px: 1/72 of the width, clamped
const MIN_DOT_PX = 0.35;               // dots smaller than this (buffer px) are not drawn
const SAMPLE_W = 200;                  // the luminance is sampled once at this width
const LEVELS = [0.02, 0.98];           // luminance percentiles stretched to 0 and 1 before dotRadius
const BRUSH = 0.1;                     // brush radius as a share of the canvas width: a mouse's or pen's,
const COARSE_BRUSH = 0.14;             // and a finger's and the automatic sweep's
const BRUSH_SPACING = 0.3;             // stamps along a segment, in brush radii
const MAX_STAMPS = 24;                 // per frame, however far the pointer went
const LOBES = 5;                       // soft discs around each brush's rim (the irregular edge)
const CRAWL = { time: 3, path: 1.8 };     // noise phase per second and per brush radius travelled
const SWEEP_S = 3.6;
const SWEEP_IN_VIEW = 0.8;             // the sweep starts once this share of the canvas (or of the viewport) shows it
// The sweep's path, in shares of the canvas: up the left edge, over the top and down the right edge past the
// shoulder (around a centred subject: on the About photo, the sky, then the sky and the canyon on the right).
const SWEEP_PATH = [[0.05, 0.48], [0.1, 0.14], [0.5, 0.03], [0.88, 0.14], [0.93, 0.42], [0.88, 0.66], [0.9, 0.86]];
const IN_VIEW_THRESHOLDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const TAU = Math.PI * 2;

/** Radius of a halftone dot for luminance `lum` (0 black … 1 white) in a cell of pitch `cell`; never negative. */
export function dotRadius(lum, cell) {
  return cell * 0.5 * Math.sqrt(Math.max(0, 1 - lum));
}

/** The share of the wipe healed in `dt` seconds (applied with destination-out). */
export function healAlpha(dt) {
  return 1 - Math.exp(-dt / HEAL_S);
}

/** Whether the loop needs another frame: only in view, and only while the pointer is recent or a wipe remains. */
export function shouldRun({ inView, msSincePointer, maskEmpty }) {
  return inView && (msSincePointer < POINTER_WINDOW_MS || !maskEmpty);
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Per-pixel luminance (0 black … 1 white, Rec. 709) of RGBA bytes, ready for dotRadius: the levels are stretched so
 * the 2nd/98th percentiles of the opaque pixels (alpha ≥ 50%) become 0 and 1 (left as they are if that range is
 * under 0.05), then each pixel is laid over white by its alpha, so a cut-out's transparent ground gets no dots.
 */
export function luminanceField(rgba) {
  const n = rgba.length >> 2;
  const lum = new Float32Array(n);
  const opaque = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    lum[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
    if (rgba[j + 3] >= 128) opaque[count++] = lum[i];
  }
  let lo = 0;
  let hi = 1;
  if (count > 0) {
    const sorted = opaque.subarray(0, count).sort();
    const at = (q) => sorted[Math.round(q * (count - 1))];
    if (at(LEVELS[1]) - at(LEVELS[0]) >= 0.05) {
      lo = at(LEVELS[0]);
      hi = at(LEVELS[1]);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    lum[i] = 1 - a * (1 - clamp((lum[i] - lo) / (hi - lo), 0, 1));
  }
  return lum;
}

/** Smooth 1-D value noise in [0, 1). */
function hash(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i);
  return a + (hash(i + 1) - a) * f * f * (3 - 2 * f);
}

/** Catmull-Rom point at s ∈ [0, 1] along `points`, written into `out`. */
function pathPoint(points, s, out) {
  const n = points.length - 1;
  const t = clamp(s, 0, 1) * n;
  const i = Math.min(Math.floor(t), n - 1);
  const f = t - i;
  const p0 = points[Math.max(i - 1, 0)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(i + 2, n)];
  for (let k = 0; k < 2; k++) {
    out[k] = 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * f
      + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f
      + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * f * f * f);
  }
  return out;
}

function makeCanvas(w = 0, h = 0) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** A soft round brush (alpha only matters: the mask is used with destination-out). */
function makeBrush() {
  const size = 64;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgb(0 0 0 / 1)');
  grad.addColorStop(0.7, 'rgb(0 0 0 / 1)');
  grad.addColorStop(1, 'rgb(0 0 0 / 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/**
 * Mounts the reveal of `img` on `canvas` (laid over the image, same box). `interactive`: pointer moves (mouse,
 * pen) and touches on the canvas wipe the dots. `autoSweep`: one slow automatic sweep the first time the canvas is
 * well in view. Nothing loads or draws until start(), which makes the image load now (it may be lazy), samples it,
 * draws the halftone and sets the image to opacity 0 once the canvas has drawn (it stays in the accessibility
 * tree). start() resolves to true once the image is ready, false if it failed to load (the image is then left as
 * it is). stop() parks the reveal; resize() re-renders the layers for the canvas's current size;
 * destroy() also gives the image back its opacity and frees the layers.
 */
export function createHalftoneReveal({ canvas, img, interactive = false, autoSweep = false }) {
  let ctx = null;
  let halftone = null;
  let photo = null;
  let scratch = null;
  let mask = null;
  let maskCtx = null;
  let brush = null;

  let lum = null;                      // sampled luminance, levels stretched
  let lumW = 0;
  let lumH = 0;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let W = 0;                           // buffer size
  let H = 0;

  let prepared = null;                 // Promise<boolean>: the image loaded and sampled
  let generation = 0;                  // bumped by destroy(), so a load still in flight then draws nothing
  let started = null;
  let running = false;
  let attached = false;
  let io = null;
  let inView = false;
  let raf = 0;
  let last = 0;
  let drawn = false;
  let showing = '';                    // what the canvas holds: '' (stale), 'halftone' or 'reveal'

  let maskEmpty = true;
  let level = 0;                       // the strongest mask alpha, tracked analytically (no readback)
  let lastPointerAt = -Infinity;
  const pointer = { x: 0, y: 0, dirty: false };
  let brushShare = BRUSH;
  let hasPrev = false;
  let prevX = 0;
  let prevY = 0;
  let travel = 0;                      // path length stamped so far, in brush radii (the noise phase)

  let sweepPending = autoSweep;
  let sweeping = false;
  let sweepStart = 0;
  const sweepAt = [0, 0];

  async function prepare() {
    const gen = generation;
    try {
      if (img.loading === 'lazy') img.loading = 'eager';
      await img.decode();
    } catch (err) {
      console.warn('Halftone reveal: the image did not load; it stays as it is.', err);
      return false;
    }
    if (gen !== generation) return false;
    sampleLuminance();
    layout();
    return true;
  }

  function sampleLuminance() {
    lumW = Math.min(SAMPLE_W, img.naturalWidth);
    lumH = Math.max(1, Math.round((lumW * img.naturalHeight) / img.naturalWidth));
    const c = makeCanvas(lumW, lumH);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, lumW, lumH);
    lum = luminanceField(g.getImageData(0, 0, lumW, lumH).data);
    c.width = 0;
  }

  function sampleLum(u, v) {
    const x = clamp(u - 0.5, 0, lumW - 1);
    const y = clamp(v - 0.5, 0, lumH - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, lumW - 1);
    const y1 = Math.min(y0 + 1, lumH - 1);
    const fx = x - x0;
    const top = lum[y0 * lumW + x0] + (lum[y0 * lumW + x1] - lum[y0 * lumW + x0]) * fx;
    const bottom = lum[y1 * lumW + x0] + (lum[y1 * lumW + x1] - lum[y1 * lumW + x0]) * fx;
    return top + (bottom - top) * (y - y0);
  }

  /** The image's source rect as object-fit: cover (centred) shows it in the canvas box. */
  function coverSource() {
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const s = Math.max(cssW / iw, cssH / ih);
    const sw = cssW / s;
    const sh = cssH / s;
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
  }

  /** Sizes every layer to the canvas's current box and re-renders them; false while the canvas has no size. */
  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, MAX_DPR);
    if (!(w > 0 && h > 0)) return false;
    if (w === cssW && h === cssH && ratio === dpr && W > 0) return true;
    cssW = w;
    cssH = h;
    dpr = ratio;
    W = Math.round(w * ratio);
    H = Math.round(h * ratio);
    ctx ??= canvas.getContext('2d');
    halftone ??= makeCanvas();
    photo ??= makeCanvas();
    scratch ??= makeCanvas();
    mask ??= makeCanvas();
    brush ??= makeBrush();
    for (const c of [canvas, halftone, photo, scratch]) {
      c.width = W;
      c.height = H;
    }
    mask.width = Math.ceil(W / MASK_SCALE);
    mask.height = Math.ceil(H / MASK_SCALE);
    maskCtx = mask.getContext('2d');
    maskCtx.fillStyle = '#000';
    renderPhoto();
    renderHalftone();
    clearMask();
    hasPrev = false;
    showing = '';
    compose();
    return true;
  }

  function renderPhoto() {
    const g = photo.getContext('2d');
    const { sx, sy, sw, sh } = coverSource();
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  }

  function renderHalftone() {
    const g = halftone.getContext('2d');
    const style = getComputedStyle(canvas);
    g.fillStyle = style.getPropertyValue('--c-paper').trim() || '#F6F6F3';
    g.fillRect(0, 0, W, H);
    const cell = clamp(cssW * CELL.share, CELL.min, CELL.max) * dpr;
    const rowH = (cell * Math.sqrt(3)) / 2;   // a hexagonal grid: every row offset by half a cell
    const { sx, sy, sw, sh } = coverSource();
    const ku = (sw / img.naturalWidth) * (lumW / W);
    const kv = (sh / img.naturalHeight) * (lumH / H);
    const u0 = (sx / img.naturalWidth) * lumW;
    const v0 = (sy / img.naturalHeight) * lumH;
    g.beginPath();
    let row = 0;
    for (let y = rowH / 2; y < H + rowH; y += rowH, row++) {
      for (let x = row % 2 ? 0 : cell / 2; x < W + cell; x += cell) {
        const r = dotRadius(sampleLum(u0 + x * ku, v0 + y * kv), cell);
        if (r < MIN_DOT_PX) continue;
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, TAU);
      }
    }
    g.fillStyle = style.getPropertyValue('--c-ink').trim() || '#0A0A0A';
    g.fill();
  }

  function clearMask() {
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    level = 0;
    maskEmpty = true;
  }

  function heal(dt) {
    const a = healAlpha(dt);
    maskCtx.globalCompositeOperation = 'destination-out';
    maskCtx.globalAlpha = a;
    maskCtx.fillRect(0, 0, mask.width, mask.height);
    maskCtx.globalAlpha = 1;
    maskCtx.globalCompositeOperation = 'source-over';
    level *= 1 - a;
    if (level < EMPTY) clearMask();
  }

  /**
   * One brush: a soft core plus LOBES smaller soft discs around its rim, every radius (and the lobes' angles)
   * following 1-D noise in `phase`, so the wipe's edge is irregular and crawls as time and the path advance.
   */
  function stampBrush(x, y, R, phase) {
    const core = R * (0.55 + 0.3 * noise1(phase));
    maskCtx.drawImage(brush, x - core, y - core, 2 * core, 2 * core);
    for (let j = 0; j < LOBES; j++) {
      const a = (j / LOBES) * TAU + 1.6 * noise1(phase * 0.5 + j * 5.3);
      const r = R * (0.12 + 0.45 * noise1(phase + j * 13.7));
      const lx = x + Math.cos(a) * R * 0.7;
      const ly = y + Math.sin(a) * R * 0.7;
      maskCtx.drawImage(brush, lx - r, ly - r, 2 * r, 2 * r);
    }
  }

  /** Stamps the segment from the last stamped point to the pointer (mask px). */
  function stampSegment(tSec) {
    const k = mask.width / cssW;       // CSS px → mask px
    const R = brushShare * cssW * k;
    const bx = pointer.x * k;
    const by = pointer.y * k;
    const ax = hasPrev ? prevX * k : bx;
    const ay = hasPrev ? prevY * k : by;
    const dist = Math.hypot(bx - ax, by - ay);
    const n = hasPrev ? clamp(Math.ceil(dist / (R * BRUSH_SPACING)), 1, MAX_STAMPS) : 1;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      travel += dist / n / R;
      stampBrush(ax + (bx - ax) * f, ay + (by - ay) * f, R, tSec * CRAWL.time + travel * CRAWL.path);
    }
    prevX = pointer.x;
    prevY = pointer.y;
    hasPrev = true;
    pointer.dirty = false;
    level = 1;
    maskEmpty = false;
  }

  function compose() {
    if (!W) return;
    if (maskEmpty) {
      if (showing === 'halftone') return;
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(halftone, 0, 0);
      showing = 'halftone';
    } else {
      const s = scratch.getContext('2d');
      s.globalCompositeOperation = 'copy';
      s.drawImage(halftone, 0, 0);
      s.globalCompositeOperation = 'destination-out';
      s.drawImage(mask, 0, 0, W, H);
      s.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(photo, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratch, 0, 0);
      showing = 'reveal';
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!drawn) {
      drawn = true;
      img.style.opacity = '0';
    }
  }

  function stepSweep(now) {
    const s = (now - sweepStart) / (SWEEP_S * 1000);
    if (s >= 1) {
      sweeping = false;
      hasPrev = false;
      return;
    }
    pathPoint(SWEEP_PATH, 0.5 - 0.5 * Math.cos(Math.PI * Math.max(s, 0)), sweepAt);
    pointer.x = sweepAt[0] * cssW;
    pointer.y = sweepAt[1] * cssH;
    pointer.dirty = true;
    brushShare = COARSE_BRUSH;
    lastPointerAt = now;
  }

  function revealFrame(now) {
    raf = 0;
    if (!running || !W) return;
    const dt = clamp((now - last) / 1000, 0, MAX_DT);
    last = now;
    if (sweeping) stepSweep(now);
    if (!maskEmpty) heal(dt);
    if (pointer.dirty) stampSegment(now / 1000);
    compose();
    if (shouldRun({ inView, msSincePointer: now - lastPointerAt, maskEmpty })) raf = requestAnimationFrame(revealFrame);
  }

  function wake() {
    if (raf || !running || !inView) return;
    last = performance.now();
    raf = requestAnimationFrame(revealFrame);
  }

  function onPointer(e) {
    if (!running || !W) return;
    sweeping = false;                  // a real pointer takes over from the sweep
    pointer.x = e.offsetX;
    pointer.y = e.offsetY;
    pointer.dirty = true;
    brushShare = e.pointerType === 'touch' ? COARSE_BRUSH : BRUSH;
    lastPointerAt = performance.now();
    wake();
  }
  function onPointerEnd() {
    hasPrev = false;                   // the next contact or entry starts a new stroke
  }

  function onView(entries) {
    const entry = entries[entries.length - 1];   // the latest, if several crossings were queued
    inView = entry.isIntersecting;
    if (!inView) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      sweeping = false;
      hasPrev = false;
      if (!maskEmpty) {
        clearMask();                   // nobody sees it heal: the plate is clean when it comes back
        compose();
      }
      return;
    }
    const viewH = entry.rootBounds?.height || innerHeight;
    const seen = entry.intersectionRatio >= SWEEP_IN_VIEW || entry.intersectionRect.height >= SWEEP_IN_VIEW * viewH;
    if (sweepPending && seen && W) {
      sweepPending = false;
      sweeping = true;
      sweepStart = performance.now();
      hasPrev = false;
    }
    if (sweeping || !maskEmpty) wake();
  }

  function attach() {
    if (attached) return;
    attached = true;
    io = new IntersectionObserver(onView, { threshold: IN_VIEW_THRESHOLDS });
    io.observe(canvas);
    if (!interactive) return;
    canvas.addEventListener('pointermove', onPointer, { passive: true });
    canvas.addEventListener('pointerdown', onPointer, { passive: true });
    canvas.addEventListener('pointerleave', onPointerEnd, { passive: true });
    canvas.addEventListener('pointercancel', onPointerEnd, { passive: true });
  }

  function detach() {
    if (!attached) return;
    attached = false;
    io.disconnect();
    io = null;
    inView = false;
    canvas.removeEventListener('pointermove', onPointer);
    canvas.removeEventListener('pointerdown', onPointer);
    canvas.removeEventListener('pointerleave', onPointerEnd);
    canvas.removeEventListener('pointercancel', onPointerEnd);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    sweeping = false;
    hasPrev = false;
    detach();
    if (!maskEmpty) {
      clearMask();                     // parked clean: a wipe cannot freeze half-healed
      compose();
    }
  }

  return {
    start() {
      if (running) return started;
      running = true;
      prepared ??= prepare();
      started = prepared.then((ok) => {
        if (ok && running) attach();
        return ok;
      });
      return started;
    },
    stop,
    resize() {
      if (lum) layout();
    },
    destroy() {
      stop();
      generation++;
      img.style.opacity = '';
      for (const c of [halftone, photo, scratch, mask]) if (c) c.width = 0;
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      halftone = photo = scratch = mask = maskCtx = null;
      lum = null;
      prepared = null;
      drawn = false;
      cssW = cssH = W = H = 0;
    },
  };
}
