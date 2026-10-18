// The training run (spec §2.4): the stage scrub drives the epoch 0 → 100, and the epoch drives the HUD readout, the
// loss curve, the beat on screen and, with the engine, uEpoch and the orange ball rolling down its trail over the loss
// landscape (formation 3). curvePoints, framedSurface, wantsSide and plotRect are pure and Node-testable; init(ctx)
// touches the DOM and receives gsap, ScrollTrigger and the engine through ctx (this module imports no CDN library).
// Without the engine the HUD, the loss curve and the beats still scrub.
import { mulberry32 } from '../engine/formations/common.js';
import {
  EPOCHS, buildLandscape, descentPath, pathAt, landscapeToLocal, landscapeBox, surfaceSamples, epochValues, formatHud,
  beatIndex,
} from '../engine/formations/landscape.js';
import { frameDistance, rectShift } from '../engine/framing.js';

const K = 3;                           // the landscape's formation index
const SEED = 0x7a11;
const ROLL_DEG = 2.5;                  // the pose's camera roll (spec §3.3: ≤ 3°): lowers the far right corner, clear of the HUD
const CURVE = { w: 200, h: 80, top: 1.3 };   // the loss curve's viewBox; a loss sits at y = h · (1 − loss / top)
// The plot (spec §2.4): the upper 55% of the stage, `gap` px from the text around it and at least a fifth of the stage
// tall. Its top moves down in `step` px until no surface sample lands within `clear` px of the heading or the HUD.
// The surface is fitted into it with the engine's framing slack (framing.js) in `fitSteps` steps.
const PLOT = { share: 0.55, gap: 16, minShare: 0.2, clear: 16, step: 2, slack: 1.08, fitSteps: 6 };
const SCRUB_NATIVE_S = 0.3;            // spec §5.1: scrub 0.3 only when Lenis is off (it already smooths)
const RESIZE_DEBOUNCE_MS = 150;
// The ball and its trail: one small Points draw over the landscape (spec §8.1), sized in CSS px.
const BALL = { px: 12, trailPx: 3.5, trailAlpha: 0.85, fadeIn: [0.55, 0.95] };

/** Raw sRGB components of a #RRGGBB token (colours are raw sRGB uniforms, spec §4.5). */
const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const prefixes = new WeakMap();        // per series: the points of epochs 0..k joined, for every k
/**
 * The SVG polyline points of a loss series (`values` at epochs 0..n) drawn from epoch 0 to e, in the loss curve's
 * 200 × 80 viewBox: x = 200 · epoch / n, y = 80 · (1 − loss / 1.3). A fractional e ends on the lerp between its two
 * epochs; e is clamped to 0..n.
 */
export function curvePoints(values, e) {
  const n = values.length - 1;
  const point = (x, v) => `${((CURVE.w * x) / n).toFixed(2)},${(CURVE.h * (1 - v / CURVE.top)).toFixed(2)}`;
  let joined = prefixes.get(values);
  if (!joined) {
    joined = [];
    for (let k = 0; k <= n; k++) joined.push(k ? `${joined[k - 1]} ${point(k, values[k])}` : point(0, values[0]));
    prefixes.set(values, joined);
  }
  const t = Math.min(n, Math.max(0, e));
  const k = Math.floor(t);
  if (t === k) return joined[k];
  return `${joined[k]} ${point(t, values[k] + (values[k + 1] - values[k]) * (t - k))}`;
}

const DEG = Math.PI / 180;
let framed = null;                     // framedSurface's default output, reused
/**
 * Where the landscape's surface samples (surfaceSamples) land on screen, in CSS px of a vw × vh canvas, when the
 * engine frames the formation's box into `rect` (scene.js solvePose: frameDistance, rectShift and the roll, without
 * pointer parallax): x, y per sample, into `out`.
 */
export function framedSurface(rect, { vw, vh, vfov, roll = ROLL_DEG }, out) {
  const samples = surfaceSamples();
  const pts = out ?? (framed ??= new Float32Array((samples.length / 3) * 2));
  const distance = frameDistance(landscapeBox(), rect, vw, vh, vfov);
  const { dx, dy } = rectShift(rect, vw, vh, distance, vfov);
  const c = Math.cos(roll * DEG);
  const s = Math.sin(roll * DEG);
  const camX = dx * c - dy * s;          // the shift turns with the roll (scene.js solvePose)
  const camY = dx * s + dy * c;
  const tan = Math.tan((vfov * DEG) / 2);
  const aspect = vw / vh;
  for (let i = 0, j = 0; i < samples.length; i += 3, j += 2) {
    const x = samples[i] - camX;
    const y = samples[i + 1] - camY;
    const depth = distance - samples[i + 2];
    pts[j] = ((1 + (x * c + y * s) / (depth * tan * aspect)) / 2) * vw;
    pts[j + 1] = ((1 - (y * c - x * s) / (depth * tan)) / 2) * vh;
  }
  return pts;
}

/** The bottom of the stage's top text block (the heading, and the HUD beside or under it). */
const textBottom = (head, hud) => Math.max(head.y + head.h, hud.y + hud.h);
const stackedHud = (head, hud) => hud.y >= head.y + head.h;

/**
 * Whether the stage takes the side layout (a phone on its side, a very short window): the beats, held at the stage's
 * bottom, would run into the heading or the HUD, or leave the plot less than a fifth of the stage. Then the beats sit
 * under the heading and the landscape in the right column under the HUD (css/sections/training.css .is-side).
 * Measured in the regular layout.
 */
export function wantsSide({ stageH, headerBottom, head, hud, beatsTop }) {
  const top = stackedHud(head, hud) ? hud.y + hud.h + PLOT.gap : headerBottom;
  return beatsTop - PLOT.gap < Math.max(textBottom(head, hud), top + PLOT.minShare * stageH);
}

/** The bounds of framedSurface's points. */
function bounds(pts) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let j = 0; j < pts.length; j += 2) {
    if (pts[j] < b.x0) b.x0 = pts[j];
    if (pts[j] > b.x1) b.x1 = pts[j];
    if (pts[j + 1] < b.y0) b.y0 = pts[j + 1];
    if (pts[j + 1] > b.y1) b.y1 = pts[j + 1];
  }
  return b;
}

/**
 * The rect to give pose 3 so that the surface lands centred in `target`, its binding side the target's less the
 * engine's 8% slack. The engine frames the formation's box as if it were flat; the landscape is deep (its near rim is
 * a quarter closer than its far one), so seen off the screen's centre it would spill out of its rect. A few fixed-point
 * steps on framedSurface correct for that: scale by the size error, move by the centre error.
 */
export function fitFrame(target, view) {
  const rect = { ...target };
  for (let i = 0; i < PLOT.fitSteps; i++) {
    const b = bounds(framedSurface(rect, view));
    const k = Math.min(target.w / (PLOT.slack * (b.x1 - b.x0)), target.h / (PLOT.slack * (b.y1 - b.y0)));
    const cx = rect.x + rect.w / 2 + target.x + target.w / 2 - (b.x0 + b.x1) / 2;
    const cy = rect.y + rect.h / 2 + target.y + target.h / 2 - (b.y0 + b.y1) / 2;
    rect.w *= k;
    rect.h *= k;
    rect.x = cx - rect.w / 2;
    rect.y = cy - rect.h / 2;
  }
  return rect;
}

/**
 * The rect pose 3 frames the landscape's box into (spec §2.4, §4.4), in CSS px of the held stage; `head`, `hud` are
 * rects { x, y, w, h } relative to the stage's top, `beatsTop` likewise, `vw` × `vh` the canvas. The surface is fitted
 * (fitFrame) into a target area. Regular layout: the full width, ending at 55% of the stage (above the beats); it
 * starts at the header's bottom when the HUD sits beside the heading — moved down until the surface clears the heading
 * and the HUD, at most to below them — or below the HUD when it stacks under the heading. The area keeps a fifth of the
 * stage height on a stage too short for all of it. Side layout: the right column under the HUD, down to the stage's
 * bottom.
 */
export function plotRect(m) {
  const { vw, stageH, headerBottom, head, hud, beatsTop, side = false } = m;
  if (side) {
    const y = hud.y + hud.h + PLOT.gap;
    return fitFrame({ x: hud.x, y, w: vw - hud.x, h: stageH - PLOT.gap - y }, m);
  }
  const lo = Math.round(stackedHud(head, hud) ? Math.max(headerBottom, hud.y + hud.h + PLOT.gap) : headerBottom);
  const bottom = Math.round(Math.max(Math.min(PLOT.share * stageH, beatsTop - PLOT.gap), lo + PLOT.minShare * stageH));
  const hi = Math.max(lo, Math.min(Math.round(textBottom(head, hud) + PLOT.gap), Math.round(bottom - PLOT.minShare * stageH)));
  const keep = [head, hud].map((r) => ({ x0: r.x - PLOT.clear, y0: r.y - PLOT.clear, x1: r.x + r.w + PLOT.clear, y1: r.y + r.h + PLOT.clear }));
  const target = { x: 0, y: lo, w: Math.round(vw), h: bottom - lo };
  for (; target.y < hi; target.y += PLOT.step, target.h -= PLOT.step) {
    const rect = fitFrame(target, m);
    const pts = framedSurface(rect, m);
    let clear = true;
    for (let j = 0; clear && j < pts.length; j += 2) {
      const x = pts[j];
      const y = pts[j + 1];
      clear = !keep.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
    }
    if (clear) return rect;
  }
  return fitFrame({ ...target, y: hi, h: bottom - hi }, m);
}

const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export async function init(ctx) {
  const section = document.getElementById('training');
  const stage = section?.querySelector('.stage');
  const head = stage?.querySelector('.section-head');
  const hud = stage?.querySelector('.train-hud');
  const readout = stage?.querySelector('.train-readout');
  const trainLine = stage?.querySelector('.loss-curve .train');
  const valLine = stage?.querySelector('.loss-curve .val');
  const beatsEl = stage?.querySelector('.beats');
  const beats = stage ? [...stage.querySelectorAll('.beat')] : [];
  const { gsap, ScrollTrigger } = ctx;
  if (!stage || !head || !hud || !readout || !trainLine || !valLine || !beatsEl || !gsap || !ScrollTrigger) return;

  const train = [];
  const val = [];
  for (let k = 0; k <= EPOCHS; k++) {
    const v = epochValues(k);
    train.push(v.train);
    val.push(v.val);
  }

  // The epoch on screen; the ball reads it every rendered frame once the engine is there.
  let epoch = -1;
  let text = '';
  let beat = -1;
  let engine = null;
  function show(e) {
    if (e === epoch) return;
    epoch = e;
    const next = formatHud(e);
    if (next !== text) readout.textContent = text = next;
    trainLine.setAttribute('points', curvePoints(train, e));
    valLine.setAttribute('points', curvePoints(val, e));
    const b = beatIndex(e);
    if (b !== beat) {
      beat = b;
      beats.forEach((el, i) => el.classList.toggle('is-active', i === b));
    }
    if (engine) engine.state.uniforms.uEpoch = e;
  }

  // The one-at-a-time layout (css/sections/training.css) applies only once the scrub runs; until then (or if this
  // fails) the stage keeps the static layout with all four beats.
  section.classList.add('is-live');
  show(0);
  const proxy = { e: 0 };
  gsap.to(proxy, {
    e: EPOCHS,
    ease: 'none',
    onUpdate: () => show(proxy.e),
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      scrub: ctx.scroll?.lenis ? true : SCRUB_NATIVE_S,
    },
  });

  // The layout (regular or side) is the DOM's and holds without the engine; with it, each relayout also frames the
  // landscape. Re-measured on resize, refresh and late fonts.
  const header = document.querySelector('.site-header');
  const measure = () => {
    // The stage is sticky at the top while held, so positions relative to its top are where things sit then.
    const top0 = stage.getBoundingClientRect().top;
    const rel = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top - top0), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      stageH: stage.getBoundingClientRect().height,
      headerBottom: header?.getBoundingClientRect().bottom ?? 0,
      head: rel(head),                 // shrunk to its text (css/sections/training.css)
      hud: rel(hud),
      beatsTop: rel(beatsEl).y,
    };
  };
  let frame = null;                    // the engine's part of a relayout
  function relayout() {
    // The side layout is decided in the regular one (the class moves the HUD and the beats), then measured as laid out.
    section.classList.remove('is-side');
    let m = measure();
    const side = wantsSide(m);
    if (side) {
      section.classList.add('is-side');
      m = measure();
    }
    frame?.({ ...m, side });
  }
  relayout();
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, RESIZE_DEBOUNCE_MS);
  });
  ScrollTrigger.addEventListener('refresh', relayout);
  document.fonts?.addEventListener('loadingdone', relayout);

  // The engine arrives on its own schedule; init never waits for it (the sections after this one load meanwhile).
  ctx.engineReady.then((ready) => {
    if (!ready) return;
    engine = ready;
    engine.state.uniforms.uEpoch = epoch;
    frame = attachEngine({ engine, ctx, getEpoch: () => epoch });
    relayout();
  }).catch((err) => console.error('Training landscape failed.', err));
}

/**
 * Registers formation 3 and adds the ball. Returns the relayout step that frames the landscape: pose 3's rect
 * (plotRect) and the keep-out rects of the heading and the HUD.
 */
function attachEngine({ engine, ctx, getEpoch }) {
  engine.registerFormation(K, () => buildLandscape(ctx.tier.N, { rng: mulberry32(SEED) }));
  const ball = createBall(engine);
  engine.onFrame(() => ball.update(getEpoch()));

  const canvas = engine.renderer.domElement;
  const roll = ctx.reduced ? 0 : ROLL_DEG;   // the engine rolls no pose under reduced motion
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  const pose = { lookAt: [0, 0, 0], roll, rect: () => rect };
  return (m) => {
    const next = plotRect({
      ...m,
      vw: canvas.clientWidth || document.documentElement.clientWidth,
      vh: canvas.clientHeight || innerHeight,
      vfov: engine.camera.fov,
      roll,
    });
    engine.setSafeRects({ [K]: [m.head, m.hud] });
    if (sameRect(next, rect)) return;
    Object.assign(rect, next);
    engine.setPose(K, pose);           // re-runs the built landscape's density estimate at the new framing
  };
}

const BALL_VERTEX = /* glsl */ `
uniform float uEpoch;
uniform vec3 uBall;
uniform float uAlpha;
uniform float uDpr;
attribute float aIndex;              // 0..100: the trail point of that epoch; 101: the ball
varying float vAlpha;
varying float vSize;
varying float vBall;
void main() {
  float ball = step(100.5, aIndex);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(position, uBall, ball), 1.0);
  float shown = max(ball, step(aIndex, uEpoch));
  vSize = mix(${BALL.trailPx.toFixed(2)}, ${BALL.px.toFixed(2)}, ball) * uDpr;
  gl_PointSize = vSize;
  vAlpha = uAlpha * shown * mix(${BALL.trailAlpha.toFixed(2)}, 1.0, ball);
  vBall = ball;
  if (shown < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const BALL_FRAGMENT = /* glsl */ `
uniform vec3 uSignal;
uniform vec3 uPaper;
varying float vAlpha;
varying float vSize;
varying float vBall;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  float a = vAlpha * (1.0 - smoothstep(1.0 - min(2.0 / vSize, 1.0), 1.0, r));   // 1 px feathered edge
  vec3 c = mix(uSignal, uPaper, vBall * smoothstep(0.66, 0.76, r));             // the ball wears a paper ring
  gl_FragColor = vec4(c * a, a);                                                  // premultiplied
}`;

/**
 * The orange ball and its 101-point trail (spec §2.4): one Points of 102 vertices at formation 3's origin, drawn over
 * the particles. The trail shows epochs 0..⌊e⌋, the ball sits at P(e); both fade in as the landscape forms.
 */
function createBall(engine) {
  const { THREE } = engine;
  const P = descentPath();
  const position = new Float32Array((P.length + 1) * 3);
  const index = new Float32Array(P.length + 1);
  const p = [0, 0, 0];
  P.forEach(([x, y, f], k) => {
    position.set(landscapeToLocal(x, y, f, p), k * 3);
    index[k] = k;
  });
  index[P.length] = P.length;          // the ball (its position comes from uBall)
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aIndex', new THREE.BufferAttribute(index, 1));
  const uniforms = {
    uEpoch: { value: 0 },
    uBall: { value: new THREE.Vector3() },
    uAlpha: { value: 0 },
    uDpr: { value: 1 },
    uSignal: { value: new THREE.Vector3(...srgb('#FF4D00')) },
    uPaper: { value: new THREE.Vector3(...srgb('#F6F6F3')) },
  };
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BALL_VERTEX,
    fragmentShader: BALL_FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: false,
  }));
  points.frustumCulled = false;
  points.renderOrder = 1;              // after the particles and the dust
  points.position.set(0, 0, -K * engine.D);
  points.visible = false;
  engine.scene.add(points);

  const at = [0, 0, 0];
  const pu = engine.particles.uniforms;
  return {
    update(e) {
      // Shown as far as formation 3 is: the share of it in the pair on screen, through the engine's dip opacity.
      const { from, to, mix } = engine.state.pair;
      const share = to === K ? mix : from === K ? 1 - mix : 0;
      const shown = engine.particles.points.visible && engine.particles.has(K);
      const alpha = shown ? smoothstep(BALL.fadeIn[0], BALL.fadeIn[1], share) * pu.uOpacity.value : 0;
      points.visible = alpha > 0.002;
      if (!points.visible) return;
      pathAt(e, at);
      landscapeToLocal(at[0], at[1], at[2], at);
      uniforms.uBall.value.set(at[0], at[1], at[2]);
      uniforms.uEpoch.value = e;
      uniforms.uAlpha.value = alpha;
      uniforms.uDpr.value = engine.renderer.getPixelRatio();
    },
  };
}
