// The WebGL engine core (spec §4.4, §4.5, §4.7, §4.8): renderer, camera framing, the dust tunnel, the render
// loop, resize and context loss. Particles and formations plug in on top (Task 8). main.js reaches this module
// only through await import(); its tick() runs at the end of the one GSAP ticker callback.
import * as THREE from 'three';
import { computeDpr, shouldIgnoreResize } from './tier.js';
import { frameDistance, rectShift, lerpPose } from './framing.js';
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
const ADAPT_BUDGET_MS = 20;            // p75 frame time above this steps quality down
const ADAPT_DPR_STEP = 0.25;
const HITCH_MS = 250;                  // longer gaps are stalls (tab switch, GC), not frame cost
const DEBUG_EVERY_MS = 250;

// The dust tunnel: z ∈ [+10, −(7·D + 20)] around the camera path (spec §4.4).
const DUST = { zNear: 10, zFar: -(7 * D + 20), radius: 9, size: 0.03, alpha: 0.5 };

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
 * prefers-reduced-motion at boot (camera cuts at the dip, roll 0, no parallax, static dust at 50%).
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
    uAlpha: { value: reduced ? DUST.alpha * 0.5 : DUST.alpha },
    uNight: { value: 0 },
    uDpr: { value: 1 },
    uBufferHeight: { value: 1 },
    uMaxPoint: { value: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] },
    uInk: { value: new THREE.Vector3(...INK) },
    uMist: { value: new THREE.Vector3(...MIST) },
  };
  const dust = createDust(tier.dust, dustUniforms);
  scene.add(dust);

  const measure = () => ({ w: canvas.clientWidth || innerWidth, h: canvas.clientHeight || innerHeight });
  let size = measure();
  let dpr = 1;
  let dprLimit = Infinity;             // adaptive DPR only ever lowers this
  let night = 0;

  const fullRect = () => ({ x: 0, y: 0, w: size.w, h: size.h });
  const DEFAULT_POSE = { lookAt: [0, 0, 0], roll: 0, rect: fullRect, box: { w: 4, h: 4 } };
  const poses = [];
  const poseA = { x: 0, y: 0, z: 0, roll: 0 };
  const poseB = { x: 0, y: 0, z: 0, roll: 0 };
  const cam = { x: 0, y: 0, z: 0, roll: 0 };
  const shift = { dx: 0, dy: 0 };
  let yaw = 0;
  let pitch = 0;

  const state = {
    boundaries: new Float32Array(7),
    /** The resolved formation pair the camera blends between; the resolver (Task 8) writes it every tick. */
    pair: { from: 0, to: 0, mix: 0 },
    /** CSS px; speed in CSS px/s, decaying once the pointer rests; mouse and pen only. */
    pointer: { x: 0, y: 0, speed: 0, inside: false },
    uniforms: {},
  };

  const listeners = {};
  function emit(name) {
    for (const cb of listeners[name] ?? []) {
      try { cb(); } catch (err) { console.error(err); }
    }
  }

  // Camera: each pose solved to { x, y, z, roll } — formation k's box framed into its rect — then blended.
  function solvePose(k, out) {
    const pose = poses[k] ?? DEFAULT_POSE;
    let rect = pose.rect();
    if (!(rect.w > 0 && rect.h > 0)) rect = fullRect();
    const distance = frameDistance(pose.box, rect, size.w, size.h, VFOV);
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
    const follow = !reduced && pointer.inside;
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
    dpr = computeDpr(Math.min(tier.dprCap, dprLimit, devicePixelRatio || 1), size.w, size.h);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    dustUniforms.uDpr.value = dpr;
    dustUniforms.uBufferHeight.value = renderer.getDrawingBufferSize(bufferSize).y;
  }

  function ground(n) {
    night = clamp(n, 0, 1);
    const [r, g, b] = PAPER.map((c, i) => c + (NIGHT[i] - c) * night);
    renderer.setClearColor(clearColor.setRGB(r, g, b, THREE.SRGBColorSpace), 1);
    dustUniforms.uNight.value = night;
    dust.material.blending = night >= 0.5 ? THREE.AdditiveBlending : THREE.MultiplyBlending;
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

  // Adaptive quality (spec §4.1): from the veil lift, frames are judged in windows of 120; each window whose p75
  // is over budget lowers DPR by 0.25 down to 1.0, then hides the dust. It never steps back up.
  const frameMs = new Float32Array(ADAPT_FRAMES);
  let sampled = 0;
  let adapting = false;
  veil.onLift(() => { adapting = true; sampled = 0; });

  function adapt(ms) {
    if (!adapting || ms > HITCH_MS) return;
    frameMs[sampled++] = ms;
    if (sampled < ADAPT_FRAMES) return;
    sampled = 0;
    frameMs.sort();
    if (frameMs[Math.ceil(ADAPT_FRAMES * 0.75) - 1] <= ADAPT_BUDGET_MS) return;
    if (dpr > 1) {
      dprLimit = Math.max(1, dpr - ADAPT_DPR_STEP);
      applySize();
    } else {
      dust.visible = false;
      adapting = false;
    }
  }

  const debugEl = new URLSearchParams(location.search).has('debug') ? createDebugPanel() : null;
  let debugFrames = 0;
  let debugSince = -Infinity;
  function updateDebug(timeMs) {
    debugFrames++;
    if (timeMs - debugSince < DEBUG_EVERY_MS) return;
    const fps = debugSince > -Infinity ? Math.round((debugFrames * 1000) / (timeMs - debugSince)) : 0;
    const { from, to, mix } = state.pair;
    debugEl.textContent = `${tier.name}  N ${tier.N}  dust ${dust.visible ? tier.dust : 'off'}\n`
      + `DPR ${dpr.toFixed(2)}  ${fps} fps\nfrom ${from} → ${to}  mix ${mix.toFixed(3)}`;
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
    updateCamera(dt);
    if (timeMs - lastRender < renderGapMs) return;
    lastRender = timeMs;
    dustUniforms.uTime.value = elapsed;
    for (const cb of frameCallbacks) cb(timeMs, dt);
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

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = measure();
      if ((next.w === size.w && next.h === size.h) || shouldIgnoreResize(size, next, coarse)) return;
      size = next;
      applySize();
    }, RESIZE_DEBOUNCE_MS);
  });

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
    /** Pose of formation k: look-at point (local to k), roll in degrees (≤ 3), target rect (CSS px), box (world). */
    setPose(k, pose) {
      poses[k] = { ...DEFAULT_POSE, ...pose };
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
