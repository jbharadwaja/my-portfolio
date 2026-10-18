// The WebGL engine core (spec §4.3–§4.8): renderer, camera framing, the dust tunnel, the formation particles and
// their morph resolver, density control, keep-out, cursor repulsion, the render loop, resize and context loss.
// main.js reaches this module only through await import(); its tick() runs at the end of the one GSAP ticker
// callback.
import * as THREE from 'three';
import { computeDpr, shouldIgnoreResize, overFrameBudget } from './tier.js';
import { frameDistance, rectShift, lerpPose } from './framing.js';
import { resolve, applyEntrance, limitRate } from './resolver.js';
import { createMorphState, stepMorph } from './morph.js';
import { alphaForPoints } from './density.js';
import { createParticles } from './particles.js';
import { sizeFactor } from './shaders.js';
import { veil } from '../ui/veil.js';

const D = 30;                          // formation spacing along −z (spec §4.2)
const VFOV = 35;
const DEG = Math.PI / 180;
const MAX_ROLL_DEG = 3;
const PARALLAX = 2.5 * DEG;            // ± yaw/pitch at the window edges
const PARALLAX_EASE = 3;               // 1/s
const POINTER_SPEED_DECAY = 8;         // 1/s, once the pointer stops sending moves
const RESIZE_DEBOUNCE_MS = 150;
const RESTORE_WAIT_MS = 3000;
const ADAPT_FRAMES = 120;
const ADAPT_DPR_STEP = 0.25;
const HITCH_MS = 250;                  // longer gaps are stalls (tab switch, GC), not frame cost
const DEBUG_EVERY_MS = 250;
const DENSITY_GRID = 64;               // spec §4.5 screen histogram

// Cursor repulsion (spec §4.6): a CPU spring (damping ratio 0.6) kicked by pointer speed; the shader pushes
// particles away from a lagged mouse by max(spring, 0). Sections 4 (Experiments) and 5 (Route) ease it out.
const PUSH = { omega: 2 * Math.PI * 1.5, zeta: 0.6, fullSpeed: 700, max: 0.28, lag: 9, fadeS: 0.3 };
const REPULSION_IN = [true, true, true, true, false, false, true, true];
const DEFAULT_BOX = { w: 4, h: 4 };
const OFF_NDC = 9;                     // a keep-out rect parked far off screen
/** Particle uniforms the engine writes itself; state.uniforms cannot override them. */
const ENGINE_UNIFORMS = new Set(['uMix', 'uFrom', 'uTo', 'uTime', 'uAlpha', 'uBox', 'uSizeScale', 'uDpr', 'uBufferHeight',
  'uMaxPoint', 'uViewport', 'uNight', 'uOpacity', 'uPush', 'uMouse', 'uSafe']);

// The dust tunnel: z ∈ [+10, −(7·D + 20)] around the camera path (spec §4.4).
const DUST = { zNear: 10, zFar: -(7 * D + 20), radius: 9, size: 0.03, alpha: 0.5 };
/** Under reduced motion the dust is static at 50% of its alpha (spec §3.3). */
const dustAlphaFor = (reduced) => (reduced ? DUST.alpha * 0.5 : DUST.alpha);

/** Raw sRGB components of a #RRGGBB token (spec §4.5: colours are raw sRGB, no colour-space chunk). */
const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const PAPER = srgb('#F6F6F3');
const NIGHT = srgb('#0E0F12');
const INK = srgb('#0A0A0A');
const MIST = srgb('#E9E9E4');

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const DUST_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uAlpha;
uniform float uNight;
uniform float uDpr;
uniform float uBufferHeight;
uniform float uMaxPoint;
attribute vec2 aSeed;
varying float vAlpha;
varying float vSize;
void main() {
  float phase = aSeed.x * 6.2831853;
  vec3 p = position + 0.12 * vec3(sin(uTime * 0.23 + phase), cos(uTime * 0.19 + phase * 1.3), sin(uTime * 0.17 + phase * 0.7));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_Position = projectionMatrix * mv;
  float px = uSize * (0.5 + aSeed.y) * projectionMatrix[1][1] * uBufferHeight * 0.5 / max(depth, 0.001);
  vSize = clamp(px, 1.0, min(12.0 * uDpr, uMaxPoint));
  gl_PointSize = vSize;
  vAlpha = uAlpha * (0.4 + 0.6 * aSeed.x)
    * min(px * px, 1.0)                              // sub-pixel dust fades out instead of sticking at 1 px
    * smoothstep(0.6, 2.0, depth)                    // near fade
    * smoothstep(0.0, 0.08, abs(uNight - 0.5));      // opacity dips across the ground flip
  if (depth < 0.3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uMist;
uniform float uNight;
varying float vAlpha;
varying float vSize;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  float a = vAlpha * (1.0 - smoothstep(1.0 - min(2.0 / vSize, 1.0), 1.0, r));   // 1 px feathered edge
  gl_FragColor = vec4(mix(uInk, uMist, uNight) * a, a);                           // premultiplied
}`;

function createDust(count, uniforms) {
  const position = new Float32Array(count * 3);
  const seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const r = DUST.radius * Math.sqrt(Math.random());
    const a = Math.random() * 2 * Math.PI;
    position[i * 3] = r * Math.cos(a);
    position[i * 3 + 1] = r * Math.sin(a);
    position[i * 3 + 2] = DUST.zFar + Math.random() * (DUST.zNear - DUST.zFar);
    seed[i * 2] = Math.random();
    seed[i * 2 + 1] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DUST_VERTEX,
    fragmentShader: DUST_FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.MultiplyBlending,
    depthWrite: false,
    depthTest: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

function createDebugPanel() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', right: '8px', bottom: '8px', zIndex: '200', padding: '6px 8px', pointerEvents: 'none',
    font: '11px/1.5 var(--font-mono)', whiteSpace: 'pre', color: 'var(--c-ink)', background: 'var(--c-paper)',
    border: '1px solid var(--c-line)',
  });
  document.body.append(el);
  return el;
}

/**
 * Creates the renderer on `canvas` (throws without WebGL2). `tier` is pickTier()'s row; `reduced` is
 * prefers-reduced-motion (camera cuts at the dip, roll 0, no parallax, drift or repulsion, static dust at 50%), and
 * follows the preference through setReduced().
 */
export async function createEngine({ canvas, tier, reduced }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
  const gl = renderer.getContext();
  const coarse = matchMedia('(pointer: coarse)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VFOV, 1, 0.1, 400);
  camera.rotation.order = 'YXZ';       // yaw, then pitch, then roll about the view axis
  const timer = new THREE.Timer();
  const clearColor = new THREE.Color();
  const bufferSize = new THREE.Vector2();
  const v = new THREE.Vector3();

  const dustUniforms = {
    uTime: { value: 0 },
    uSize: { value: DUST.size },
    uAlpha: { value: dustAlphaFor(reduced) },
    uNight: { value: 0 },
    uDpr: { value: 1 },
    uBufferHeight: { value: 1 },
    uMaxPoint: { value: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] },
    uInk: { value: new THREE.Vector3(...INK) },
    uMist: { value: new THREE.Vector3(...MIST) },
  };
  const dust = createDust(tier.dust, dustUniforms);
  let dustAlpha = dustUniforms.uAlpha.value;
  scene.add(dust);
  const debug = new URLSearchParams(location.search).has('debug');
  const dev = debug || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  const measure = () => ({ w: canvas.clientWidth || innerWidth, h: canvas.clientHeight || innerHeight });
  let size = measure();
  let dpr = 1;
  let appliedRatio = 0;                // the devicePixelRatio the drawing buffer was last sized for
  let dprLimit = Infinity;             // adaptive DPR only ever lowers this
  let night = 0;

  const viewRect = { x: 0, y: 0, w: 0, h: 0 };
  /** The whole viewport (a reused scratch rect: solvePose runs twice a tick). */
  const fullRect = () => {
    viewRect.x = 0;
    viewRect.y = 0;
    viewRect.w = size.w;
    viewRect.h = size.h;
    return viewRect;
  };
  const DEFAULT_POSE = { lookAt: [0, 0, 0], roll: 0, rect: fullRect, box: null };
  const poses = [];
  /** Per formation k: { builder, formation, ready, pending, failed, version } (spec §4.2). */
  const formations = [];
  const poseA = { x: 0, y: 0, z: 0, roll: 0 };
  const poseB = { x: 0, y: 0, z: 0, roll: 0 };
  const cam = { x: 0, y: 0, z: 0, roll: 0 };
  const shift = { dx: 0, dy: 0 };
  let yaw = 0;
  let pitch = 0;

  const state = {
    /** Morph boundaries 0..1: b[0] is the entrance (noise → hero), b[1..6] the section boundaries (spec §4.3). */
    boundaries: new Float32Array(7),
    /** The pair on screen (bound to the particles, framed by the camera); written every tick. */
    pair: { from: 0, to: 0, mix: 0 },
    /** CSS px; speed in CSS px/s, decaying once the pointer rests; mouse and pen only. */
    pointer: { x: 0, y: 0, speed: 0, inside: false },
    /** Section-driven particle uniforms by name (uPulse, uClusterX, uRoute, …), copied into the material each frame. */
    uniforms: {},
    /** Pointer parallax on; a section turns it off and it eases to 0 (the Route's reticle, spec §2.6). */
    parallax: true,
  };

  const particles = createParticles({ THREE, tier, reduced, spacing: D });
  const pu = particles.uniforms;
  pu.uMaxPoint.value = dustUniforms.uMaxPoint.value;
  scene.add(particles.points);

  const listeners = {};
  function emit(name) {
    for (const cb of listeners[name] ?? []) {
      try { cb(); } catch (err) { console.error(err); }
    }
  }

  // Camera: each pose solved to { x, y, z, roll } — formation k's box framed into its rect — then blended.
  // `formation` defaults to the installed one; install() passes the one it is about to install.
  function solvePose(k, out, formation = formations[k]?.formation) {
    const pose = poses[k] ?? DEFAULT_POSE;
    let rect = pose.rect();
    if (!(rect.w > 0 && rect.h > 0)) rect = fullRect();
    const box = pose.box ?? formation?.box ?? DEFAULT_BOX;
    const distance = frameDistance(box, rect, size.w, size.h, VFOV);
    rectShift(rect, size.w, size.h, distance, VFOV, shift);
    out.roll = reduced ? 0 : clamp(pose.roll, -MAX_ROLL_DEG, MAX_ROLL_DEG);
    // The shift turns with the roll, so a rolled camera still lands the box centre on the rect centre.
    const c = Math.cos(out.roll * DEG);
    const s = Math.sin(out.roll * DEG);
    out.x = pose.lookAt[0] + shift.dx * c - shift.dy * s;
    out.y = pose.lookAt[1] + shift.dx * s + shift.dy * c;
    out.z = -k * D + pose.lookAt[2] + distance;
    return out;
  }

  function updateCamera(dt) {
    const { pair, pointer } = state;
    const t = reduced ? Math.round(pair.mix) : pair.mix;     // reduced motion: a cut at the dip, no dolly
    lerpPose(solvePose(pair.from, poseA), solvePose(pair.to, poseB), t, cam);
    const follow = !reduced && pointer.inside && state.parallax;
    const nx = follow ? clamp((pointer.x / size.w) * 2 - 1, -1, 1) : 0;
    const ny = follow ? clamp(1 - (pointer.y / size.h) * 2, -1, 1) : 0;
    const k = 1 - Math.exp(-dt * PARALLAX_EASE);
    yaw += (-nx * PARALLAX - yaw) * k;
    pitch += (ny * PARALLAX - pitch) * k;
    camera.position.set(cam.x, cam.y, cam.z);
    camera.rotation.set(pitch, yaw, cam.roll * DEG);
    camera.updateMatrixWorld();
  }

  function applySize() {
    appliedRatio = devicePixelRatio || 1;
    dpr = computeDpr(Math.min(tier.dprCap, dprLimit, appliedRatio), size.w, size.h);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    dustUniforms.uDpr.value = dpr;
    dustUniforms.uBufferHeight.value = renderer.getDrawingBufferSize(bufferSize).y;
    pu.uDpr.value = dpr;
    pu.uBufferHeight.value = bufferSize.y;
    pu.uViewport.value.set(size.w, size.h);
    refreshAlphas();                   // the density histogram depends on the viewport (spec §4.8)
  }

  function ground(n) {
    night = clamp(n, 0, 1);
    const r = PAPER[0] + (NIGHT[0] - PAPER[0]) * night;
    const g = PAPER[1] + (NIGHT[1] - PAPER[1]) * night;
    const b = PAPER[2] + (NIGHT[2] - PAPER[2]) * night;
    renderer.setClearColor(clearColor.setRGB(r, g, b, THREE.SRGBColorSpace), 1);
    dustUniforms.uNight.value = night;
    dust.material.blending = night >= 0.5 ? THREE.AdditiveBlending : THREE.MultiplyBlending;
    pu.uNight.value = night;
    particles.setBlending(night >= 0.5);
  }

  // Formations (spec §4.2): registered as builders, built on demand (ensure) or in idle tasks after the veil
  // (buildDeferred). Installing one projects it at its own pose for its density alpha (spec §4.5).
  const probe = new THREE.PerspectiveCamera(VFOV, 1, 0.1, 400);
  const probePose = { x: 0, y: 0, z: 0, roll: 0 };

  let ndcScratch = new Float32Array(0);

  /**
   * Alpha for formation k from its overlap at its section pose. Dust (meta −1) keeps its own faint alpha. A formation
   * the shader places per frame (the clusters) supplies those placed positions through `densityData()` (Ruling R44).
   */
  function densityAlpha(k, formation) {
    const data = formation.densityData?.() ?? formation.data;
    solvePose(k, probePose, formation);
    probe.aspect = size.w / size.h;
    probe.updateProjectionMatrix();
    probe.position.set(probePose.x, probePose.y, probePose.z);
    probe.rotation.set(0, 0, probePose.roll * DEG);
    probe.updateMatrixWorld();
    const m = probe.matrixWorldInverse.elements;
    const p00 = probe.projectionMatrix.elements[0];
    const p11 = probe.projectionMatrix.elements[5];
    const pxAtUnitDepth = pu.uSize.value * pu.uSizeScale.value * p11 * bufferSize.y * 0.5;
    const maxPx = Math.min(32 * dpr, pu.uMaxPoint.value);
    if (ndcScratch.length < (data.length / 4) * 2) ndcScratch = new Float32Array((data.length / 4) * 2);
    const ndc = ndcScratch;
    let n = 0;
    let area = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < -0.5) continue;
      const x = data[i];
      const y = data[i + 1];
      const z = data[i + 2] - k * D;
      const depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
      if (depth < 0.3) continue;
      ndc[n * 2] = (p00 * (m[0] * x + m[4] * y + m[8] * z + m[12])) / depth;
      ndc[n * 2 + 1] = (p11 * (m[1] * x + m[5] * y + m[9] * z + m[13])) / depth;
      area += Math.min(maxPx, (pxAtUnitDepth * sizeFactor(k, data[i + 3])) / depth) ** 2;
      n++;
    }
    // Counts per 64 × 64 cell become overlap per pixel through one point's share of a cell.
    const cell = (bufferSize.x / DENSITY_GRID) * (bufferSize.y / DENSITY_GRID);
    const footprint = n > 0 ? ((Math.PI / 4) * (area / n)) / cell : 1;
    return alphaForPoints(ndc.subarray(0, n * 2), DENSITY_GRID, footprint);
  }

  /** Installs a built formation; the slot is marked ready only once setFormation has accepted it. */
  function install(k, formation) {
    if (formation.minN > tier.N) {
      const message = `Formation ${k} needs ${formation.minN} particles; the ${tier.name} tier has ${tier.N}.`;
      if (dev) throw new Error(message);
      console.warn(message);
    }
    particles.setFormation(k, formation, densityAlpha(k, formation));   // throws on a wrong particle count
    const slot = formations[k];
    slot.formation = formation;
    slot.ready = true;
  }

  /** Every installed formation's alpha, at its pose in the current viewport. */
  function refreshAlphas() {
    for (let k = 0; k < formations.length; k++) {
      const slot = formations[k];
      if (slot?.formation) pu.uAlpha.value[k] = densityAlpha(k, slot.formation);
    }
  }

  /** Builds formation k now if it needs building; returns the pending promise of an async builder, else null. */
  function build(k) {
    const slot = formations[k];
    if (!slot || slot.ready || slot.failed) return null;
    if (slot.pending) return slot.pending;
    const { version } = slot;
    const fail = (err) => {
      if (slot.version !== version) return;
      slot.failed = true;
      console.error(`Formation ${k} failed to build.`, err);
    };
    let result;
    try {
      result = slot.builder();
      if (typeof result?.then !== 'function') {
        install(k, result);
        return null;
      }
    } catch (err) {
      fail(err);
      return null;
    }
    slot.pending = Promise.resolve(result)
      .then((formation) => { if (slot.version === version) install(k, formation); })
      .finally(() => { if (slot.version === version) slot.pending = null; });
    slot.pending.catch(fail);          // logged once here; callers awaiting ensure() still see the rejection
    return slot.pending;
  }

  const BUILT = Promise.resolve();
  /** Rejects when formation k is unregistered or its builder fails (logged here once): callers must catch. */
  function ensure(k) {
    const pending = build(k);
    if (pending) return pending;
    if (formations[k]?.ready) return BUILT;
    return Promise.reject(new Error(`Formation ${k} is ${formations[k] ? 'failed' : 'not registered'}.`));
  }

  /** Registers (or replaces) formation k's builder; a replaced formation keeps showing until it is rebuilt. */
  function registerFormation(k, builder) {
    const slot = (formations[k] ??= { builder: null, formation: null, ready: false, pending: null, failed: false, version: 0 });
    slot.builder = builder;
    slot.version++;
    slot.ready = false;
    slot.failed = false;
    slot.pending = null;
    scheduleDeferred();
  }

  // After the veil: every registered-but-unbuilt formation, one per idle task.
  const onIdle = typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(cb, { timeout: 1000 })
    : (cb) => setTimeout(cb, 0);
  const unbuilt = (slot) => slot && !slot.ready && !slot.pending && !slot.failed;
  let deferring = false;
  let idleQueued = false;
  function scheduleDeferred() {
    if (!deferring || idleQueued || !formations.some(unbuilt)) return;
    idleQueued = true;
    onIdle(() => {
      idleQueued = false;
      const k = formations.findIndex(unbuilt);
      if (k >= 0) build(k);
      scheduleDeferred();
    });
  }

  // Morph (spec §4.3): the pair is resolved from scratch every tick; stepMorph (morph.js) stands in for formations
  // still building and dips the particles out, rebinds and fades them back in on a discontinuous pair change.
  const working = new Float32Array(7);
  const next = { from: 0, to: 1, mix: 0 };
  const pair = state.pair;
  const morph = createMorphState(pair);
  let warnedOverlap = false;

  function warnOverlap() {
    for (let j = 0; j < next.from; j++) {
      if (working[j] > 0 && working[j] < 1) {
        console.warn(`Morph boundaries ${j} and ${next.from} overlap; the later one wins.`);
        warnedOverlap = true;
        return;
      }
    }
  }

  function updateMorph(dt) {
    working.set(state.boundaries);
    applyEntrance(working, working[0]);    // while the entrance runs, Hero → Encoder is held at 0
    resolve(working, next);
    if (dev && !warnedOverlap) warnOverlap();
    build(next.from);
    build(next.to);
    // During a dip-out the old pair (and the camera on it) holds until the screen is empty; rebinding is idempotent.
    stepMorph(morph, next, dt, particles.has);
    const visible = particles.has(pair.from) && particles.has(pair.to);
    particles.points.visible = visible;
    if (visible) particles.bindPair(pair.from, pair.to);
    particles.setMix(pair.mix);
  }

  // Cursor repulsion (spec §4.6), on tiers with repulsion, eased out over 300 ms in Experiments and Route.
  const push = { x: 0, v: 0, strength: 0 };
  const mouse = { x: 0, y: 0, seen: false };
  function updateRepulsion(dt) {
    if (!tier.repulsion || reduced) return;
    const section = pair.mix < 0.5 ? pair.from : pair.to;
    push.strength = limitRate(push.strength, REPULSION_IN[section] ? 1 : 0, 1 / PUSH.fadeS, dt);
    const { pointer } = state;
    const target = pointer.inside ? Math.min(1, pointer.speed / PUSH.fullSpeed) : 0;
    push.v += (PUSH.omega * PUSH.omega * (target - push.x) - 2 * PUSH.zeta * PUSH.omega * push.v) * dt;
    push.x += push.v * dt;
    const nx = (pointer.x / size.w) * 2 - 1;
    const ny = 1 - (pointer.y / size.h) * 2;
    if (!mouse.seen && pointer.inside) {
      mouse.x = nx;
      mouse.y = ny;
      mouse.seen = true;
    }
    const follow = 1 - Math.exp(-dt * PUSH.lag);
    mouse.x += (nx - mouse.x) * follow;
    mouse.y += (ny - mouse.y) * follow;
    pu.uPush.value = Math.max(push.x, 0) * push.strength * PUSH.max;
    pu.uMouse.value.set(mouse.x, mouse.y);
  }

  // Text keep-out (spec §4.5): per formation k, the CSS rects (up to two) of its section's main text as laid out
  // while k is held. The current section's go to uSafe[0..1], the next one's to uSafe[2..3]. Two, because the
  // hero's bottom layout keeps particles off the copy above and below the portrait slot (Ruling R47).
  const safeRects = [];
  function rectToNdc(rect, out) {
    if (!rect || !(rect.w > 0 && rect.h > 0)) return out.set(OFF_NDC, OFF_NDC, OFF_NDC, OFF_NDC);
    return out.set(
      (rect.x / size.w) * 2 - 1,
      1 - ((rect.y + rect.h) / size.h) * 2,
      ((rect.x + rect.w) / size.w) * 2 - 1,
      1 - (rect.y / size.h) * 2,
    );
  }

  /** Copies section uniforms (state.uniforms) into the material, then the engine's own per-frame values. */
  function syncUniforms() {
    for (const name in state.uniforms) {
      const u = pu[name];
      if (!u || ENGINE_UNIFORMS.has(name)) continue;
      const value = state.uniforms[name];
      if (typeof value === 'number') u.value = value;
      else if (value && typeof u.value?.fromArray === 'function') u.value.fromArray(value);
      else if (value && u.value?.length !== undefined) for (let i = 0; i < u.value.length && i < value.length; i++) u.value[i] = value[i];
    }
    const from = safeRects[pair.from];
    const to = safeRects[pair.to];
    rectToNdc(from?.[0], pu.uSafe.value[0]);
    rectToNdc(from?.[1], pu.uSafe.value[1]);
    rectToNdc(to?.[0], pu.uSafe.value[2]);
    rectToNdc(to?.[1], pu.uSafe.value[3]);
    pu.uTime.value = elapsed;
    pu.uOpacity.value = morph.opacity;
    dustUniforms.uAlpha.value = dustAlpha * morph.opacity;
  }

  // Loop state. The ticker always runs; the cap only skips renderer.render() and the onFrame callbacks.
  const frameCallbacks = [];
  const renderGapMs = tier.renderCap > 0 ? 1000 / tier.renderCap - 1 : 0;
  let lastRender = -Infinity;
  let elapsed = 0;                     // drift time, integrated with the clamped dt
  let resync = true;                   // the next delta follows a gap (first frame, resume, tab return)
  let paused = false;
  let hidden = document.hidden;
  let lost = false;
  let failed = false;
  let restoreTimer = 0;

  // Adaptive quality (spec §4.1): from the veil lift, frame intervals are judged in windows of 120; each window
  // over budget (overFrameBudget: p75 > max(20 ms, 1.25 × median), so a steady 30 Hz rAF is not a struggling GPU)
  // lowers DPR by 0.25 down to 1.0, then hides the dust. It never steps back up. The first window after the lift
  // is not judged: it carries the idle-task formation builds (buildDeferred).
  const frameMs = new Float32Array(ADAPT_FRAMES);
  let sampled = 0;
  let adapting = false;
  let skipWindow = true;
  veil.onLift(() => {
    adapting = true;
    sampled = 0;
    skipWindow = true;
  });

  function adapt(ms) {
    if (!adapting || ms > HITCH_MS) return;
    frameMs[sampled++] = ms;
    if (sampled < ADAPT_FRAMES) return;
    sampled = 0;
    if (skipWindow) {
      skipWindow = false;
      return;
    }
    frameMs.sort();
    if (!overFrameBudget(frameMs)) return;
    if (dpr > 1) {
      dprLimit = Math.max(1, dpr - ADAPT_DPR_STEP);
      applySize();
    } else {
      dust.visible = false;
      adapting = false;
    }
  }

  const debugEl = debug ? createDebugPanel() : null;
  let debugFrames = 0;
  let debugSince = -Infinity;
  function updateDebug(timeMs) {
    debugFrames++;
    if (timeMs - debugSince < DEBUG_EVERY_MS) return;
    const fps = debugSince > -Infinity ? Math.round((debugFrames * 1000) / (timeMs - debugSince)) : 0;
    const { from, to, mix } = state.pair;
    debugEl.textContent = `${tier.name}  N ${tier.N}  dust ${dust.visible ? tier.dust : 'off'}\n`
      + `DPR ${dpr.toFixed(2)}  ${fps} fps\nfrom ${from} → ${to}  mix ${mix.toFixed(3)}${morph.held ? '  (stand-in)' : ''}\n`
      + `entrance ${working[0].toFixed(2)}  dip ${morph.dip} ${morph.opacity.toFixed(2)}\n`
      + `alpha ${pu.uAlpha.value[from].toFixed(3)} → ${pu.uAlpha.value[to].toFixed(3)}  push ${pu.uPush.value.toFixed(3)}`;
    debugFrames = 0;
    debugSince = timeMs;
  }

  function tick(timeMs) {
    if (paused || hidden || lost) return;
    timer.update(timeMs);
    const delta = resync ? 0 : Math.max(0, timer.getDelta());
    resync = false;
    const dt = Math.min(delta, 1 / 30);
    if (delta > 0) adapt(delta * 1000);
    if (!reduced) elapsed += dt;
    state.pointer.speed *= Math.exp(-dt * POINTER_SPEED_DECAY);
    updateMorph(dt);
    updateRepulsion(dt);
    updateCamera(dt);
    if (timeMs - lastRender < renderGapMs) return;
    lastRender = timeMs;
    dustUniforms.uTime.value = elapsed;
    for (let i = 0; i < frameCallbacks.length; i++) frameCallbacks[i](timeMs, dt);
    syncUniforms();
    renderer.render(scene, camera);
    if (debugEl) updateDebug(timeMs);
  }

  // Input, visibility, resize, context loss.
  let lastMoveAt = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const p = state.pointer;
    const gap = (e.timeStamp - lastMoveAt) / 1000;
    p.speed = p.inside && gap > 0 ? Math.hypot(e.clientX - p.x, e.clientY - p.y) / Math.max(gap, 1 / 120) : 0;
    p.x = e.clientX;
    p.y = e.clientY;
    p.inside = true;
    lastMoveAt = e.timeStamp;
  }, { passive: true });
  addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) state.pointer.inside = false;
  });

  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (!hidden) resync = true;
  });

  // A pixel-ratio change (a window moved to another screen, page zoom) applies even when the CSS size, or a
  // coarse-pointer URL-bar resize, would not.
  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = measure();
      const resized = !(next.w === size.w && next.h === size.h) && !shouldIgnoreResize(size, next, coarse);
      if (!resized && (devicePixelRatio || 1) === appliedRatio) return;
      if (resized) size = next;
      applySize();
    }, RESIZE_DEBOUNCE_MS);
  }
  addEventListener('resize', onResize);
  // Not every browser fires resize for a pixel-ratio change alone, so the current ratio is watched as well.
  (function watchRatio() {
    matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`).addEventListener('change', () => {
      onResize();
      watchRatio();
    }, { once: true });
  })();

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      failed = true;
      emit('contextfail');
    }, RESTORE_WAIT_MS);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (failed) return;
    clearTimeout(restoreTimer);
    // three has rebuilt its GL state (and re-uploads buffers on the next render) but reset the clear colour.
    applySize();
    ground(night);
    lost = false;
    resync = true;
  });

  applySize();
  ground(0);
  updateCamera(0);

  return {
    THREE,
    scene,
    camera,
    renderer,
    D,
    state,
    particles,
    /**
     * Pose of formation k: look-at point (local to k), roll in degrees (≤ 3), target rect (CSS px), box (world;
     * defaults to the formation's own box). A built formation's density alpha follows its pose.
     */
    setPose(k, pose) {
      poses[k] = { ...DEFAULT_POSE, ...pose };
      const slot = formations[k];
      if (slot?.formation) pu.uAlpha.value[k] = densityAlpha(k, slot.formation);
    },
    /** builder: () => formation | Promise<formation>. Re-registering k replaces its builder and, once rebuilt, its positions. */
    registerFormation,
    /** Builds formation k now unless it is built or building; resolves when it is installed. */
    ensure,
    /** After the veil lifts: builds every registered-but-unbuilt formation, one per idle task (spec §4.2). */
    buildDeferred() {
      deferring = true;
      scheduleDeferred();
    },
    /** { [k]: rect | [rect, rect] | null }, rect = { x, y, w, h } in CSS px of formation k's section text while k
     *  is held (merged; up to two rects per formation, null entries allowed). */
    setSafeRects(rects) {
      for (const k in rects) {
        const r = rects[k];
        safeRects[k] = r ? (Array.isArray(r) ? [r[0] ?? null, r[1] ?? null] : [r, null]) : null;
      }
    },
    tick,
    /** cb(timeMs, dt) on every rendered frame, after the camera update and before the render. */
    onFrame(cb) {
      frameCallbacks.push(cb);
    },
    /** World point → CSS px in the viewport. */
    project([x, y, z], out = { x: 0, y: 0 }) {
      v.set(x, y, z).project(camera);
      out.x = ((v.x + 1) / 2) * size.w;
      out.y = ((1 - v.y) / 2) * size.h;
      return out;
    },
    /** CSS px → the point under it on formation k's z = 0 plane, in k's local frame. */
    unproject(k, cssX, cssY, out = { x: 0, y: 0 }) {
      v.set((cssX / size.w) * 2 - 1, 1 - (cssY / size.h) * 2, 0.5).unproject(camera).sub(camera.position);
      const s = (-k * D - camera.position.z) / v.z;
      out.x = camera.position.x + v.x * s;
      out.y = camera.position.y + v.y * s;
      return out;
    },
    ground,
    compile() {
      return renderer.compileAsync(scene, camera);
    },
    /**
     * prefers-reduced-motion changed (spec §3.3; main.js, gsap.matchMedia): the morph dips instead of travelling, the
     * camera cuts with roll 0, and parallax, repulsion, drift and the dust's motion stop (its alpha halves); off, all
     * of it comes back.
     */
    setReduced(on) {
      if (on === reduced) return;
      reduced = on;
      pu.uReduced.value = on ? 1 : 0;
      dustAlpha = dustAlphaFor(on);
      if (on) {
        yaw = 0;
        pitch = 0;
        push.x = 0;
        push.v = 0;
        pu.uPush.value = 0;
      }
      refreshAlphas();                 // every pose's roll changed (0 under reduced motion)
    },
    pause() {
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      resync = true;
    },
    on(name, cb) {
      (listeners[name] ??= []).push(cb);
    },
  };
}
