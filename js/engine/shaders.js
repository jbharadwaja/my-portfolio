// GLSL for the formation particles (spec §4.3, §4.5, §4.6). Two attribute slots (aFrom, aTo: xyz + meta) are
// read through each formation's own rules (placement at −k·D, cluster offsets, route reveal, network pulse,
// reticle), blended per particle with a staggered t, swirled by curl noise on the way, then shaded as ink on
// paper (MultiplyBlending) or mist on night (AdditiveBlending). Colours are raw sRGB uniforms. The dust tunnel's
// GLSL is here too: it shares the particles' text keep-out (KEEP_OUT_GLSL).

/** Lattice of the world-map formation (spec §4.2 row 5), for the reticle's row/column test. */
const MAP_COLS = 260;
const MAP_ROWS = 96;

/**
 * Resting point-size factor of a particle of formation k — mirrors shape() below, for the density estimate (the
 * shader's per-particle 0.75–1.25× variation of non-dust particles averages out and is left out here).
 */
export function sizeFactor(k, meta) {
  if (meta < -0.5) return 0.6;
  if (k === 1) return 0.7 + 0.6 * meta;
  return 1;
}

/**
 * The text keep-out (spec §4.5), shared by the formation particles and the dust tunnel: uSafe holds two NDC rects
 * per side of the pair (scene.js syncUniforms), and keepAt(ndc, t) is the alpha factor at a point for a pair at
 * mix t. The dust takes it too, so a drifting speck never darkens the text a formation keeps clear.
 */
export const KEEP_OUT_GLSL = /* glsl */ `
uniform vec2 uViewport;
uniform vec4 uSafe[4];   // two keep-out rects per side of the pair: from a, from b, to a, to b

// 1 outside the rect (NDC x0, y0, x1, y1), 0.12 inside, with a 32 px feather.
float keepOut(vec4 r, vec2 ndc) {
  vec2 outside = max(abs(ndc - 0.5 * (r.xy + r.zw)) - 0.5 * (r.zw - r.xy), 0.0) * 0.5 * uViewport;
  return mix(0.12, 1.0, smoothstep(0.0, 32.0, length(outside)));
}

// The from side's two rects, lerped to the to side's by t.
float keepAt(vec2 ndc, float t) {
  return mix(min(keepOut(uSafe[0], ndc), keepOut(uSafe[1], ndc)), min(keepOut(uSafe[2], ndc), keepOut(uSafe[3], ndc)), t);
}`;

export const PARTICLE_VERTEX = /* glsl */ `
#define PI 3.141592653589793
#define MAP_COLS ${MAP_COLS.toFixed(1)}
#define MAP_ROWS ${MAP_ROWS.toFixed(1)}
#define CURL_FREQ 0.19
#define CURL_AMP 2.4
#define CURL_DRIFT 0.06
#define PUSH_RADIUS 0.32
#define BOKEH_PX 4.5

uniform float uMix;
uniform float uTime;
uniform float uFrom;
uniform float uTo;
uniform float uAlpha[8];
uniform vec2 uBox[8];
uniform float uSize;
uniform float uSizeScale;
uniform float uDpr;
uniform float uBufferHeight;
uniform float uMaxPoint;
uniform float uNight;
uniform float uOpacity;
uniform float uReduced;
uniform float uPush;
uniform vec2 uMouse;
uniform float uPulse;
uniform float uHoverCluster;
uniform float uClusterX[8];
uniform float uClusterY;
uniform float uRoute;
uniform vec2 uReticle;
uniform float uMapStack;
uniform float uRouteAlpha;
uniform vec3 uInk;
uniform vec3 uMist;
uniform vec3 uSignal;
${KEEP_OUT_GLSL}

attribute vec4 aFrom;
attribute vec4 aTo;
attribute vec2 aSeed;

varying vec3 vColor;
varying float vAlpha;
varying float vSize;
varying float vSquare;

struct Shape {
  vec3 pos;
  float alpha;
  float size;
  float signal;
  float square;
};

int slot(float x) {
  return int(clamp(x, 0.0, 7.0) + 0.5);
}

// One particle of formation k: local xyz + meta read by that formation's rules (spec §4.2 meta column).
Shape shape(float k, vec4 a) {
  int id = slot(k);
  float meta = a.w;
  Shape s = Shape(a.xyz, uAlpha[id], 1.0, 0.0, 0.0);
  if (meta < -0.5) {
    // Spare particles: faint dust around the formation.
    s.alpha = min(s.alpha, 0.05);
    s.size = 0.6;
  } else if (id == 1) {
    // Portrait: darker cells draw larger points.
    s.size = 0.7 + 0.6 * meta;
  } else if (id == 2) {
    // Network: the layer under the pulse front keeps full strength while the others recede, so the pulse never
    // puts down more ink than the density alpha allows.
    float x = (meta - uPulse) * 6.0;
    s.alpha *= 0.55 + 0.45 * exp(-x * x);
  } else if (id == 4) {
    // Clusters: blob id sits at (uClusterX[id], uClusterY); the hovered one pulls 30% tighter and turns orange.
    float hot = step(abs(meta - uHoverCluster), 0.5);
    s.pos = a.xyz * (1.0 - 0.3 * hot) + vec3(uClusterX[slot(meta)], uClusterY, 0.0);
    s.signal = hot;
  } else if (id == 5) {
    if (meta >= 1.0) {
      // Route (meta 1 + t): drawn up to uRoute in orange, with a hot head. uRouteAlpha makes the points that
      // overlap along the line add up to full strength, so the additive glow stays orange (worldmap.js routeAlpha).
      float along = meta - 1.0;
      float lead = (uRoute - along) * 60.0;
      float head = exp(-lead * lead);
      s.alpha = uRouteAlpha * step(along, uRoute) * (1.0 + head);
      s.size = 1.0 + 1.2 * head;
      s.signal = 1.0;
    } else {
      // Land: the particles stacked on one dot share 0.9 of its alpha, so their additive glow does not saturate.
      s.alpha *= 0.9 / max(uMapStack, 1.0);
      if (uReticle.x >= 0.0) {
        // Reticle: the lattice row and column under the pointer brighten into squares.
        vec2 box = uBox[5];
        vec2 cell = floor(vec2((a.x / box.x + 0.5) * MAP_COLS, (0.5 - a.y / box.y) * MAP_ROWS));
        float on = max(step(abs(cell.x - uReticle.x), 0.5), step(abs(cell.y - uReticle.y), 0.5));
        s.alpha *= 1.0 + 1.5 * on;
        s.size = 1.0 + 0.3 * on;
        s.square = on;
      }
    }
  }
  // Per-particle size variation (0.75–1.25×) for formation particles only: dust stays at 0.6× (spec §4.2: ≤ 0.6×).
  if (meta >= -0.5) s.size *= 0.75 + 0.5 * fract(aSeed.y * 61.7);
  s.pos.z -= k * SPACING;
  return s;
}

// Integer hash → [0, 1].
float hash(ivec3 c) {
  uvec3 q = uvec3(c);
  uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (q.z * 2798796415u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h ^= h >> 13u;
  return float(h) * (1.0 / 4294967295.0);
}

// Value noise with its analytic gradient (quintic fade): xyz = gradient, w = value.
vec4 noised(vec3 p) {
  vec3 fl = floor(p);
  ivec3 i = ivec3(fl);
  vec3 f = p - fl;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash(i);
  float b = hash(i + ivec3(1, 0, 0));
  float c = hash(i + ivec3(0, 1, 0));
  float d = hash(i + ivec3(1, 1, 0));
  float e = hash(i + ivec3(0, 0, 1));
  float g = hash(i + ivec3(1, 0, 1));
  float h = hash(i + ivec3(0, 1, 1));
  float k = hash(i + ivec3(1, 1, 1));
  float k1 = b - a;
  float k2 = c - a;
  float k3 = e - a;
  float k4 = a - b - c + d;
  float k5 = a - c - e + h;
  float k6 = a - b - e + g;
  float k7 = -a + b + c - d + e - g - h + k;
  vec3 grad = du * vec3(
    k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
    k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,
    k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  float n = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  return vec4(grad, n);
}

// Curl of a noise vector potential: a divergence-free field, so particles swirl instead of bunching.
vec3 curl(vec3 p) {
  vec3 g1 = noised(p).xyz;
  vec3 g2 = noised(p + vec3(31.4, -12.7, 7.1)).xyz;
  vec3 g3 = noised(p + vec3(-9.2, 23.9, -41.3)).xyz;
  return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y);
}

void main() {
  Shape a = shape(uFrom, aFrom);
  Shape b = shape(uTo, aTo);

  float t;
  float fade = 1.0;
  if (uReduced > 0.5) {
    // Reduced motion: a dip, not a journey.
    t = step(0.5, uMix);
    fade = abs(2.0 * uMix - 1.0);
  } else {
    t = smoothstep(0.0, 1.0, clamp((uMix - aSeed.x * 0.35) / 0.65, 0.0, 1.0));
  }

  vec3 p = mix(a.pos, b.pos, t);
  float swirl = (1.0 - uReduced) * sin(PI * t);
  if (swirl > 0.001) p += curl(p * CURL_FREQ + vec3(0.0, 0.0, uTime * CURL_DRIFT)) * (CURL_AMP * swirl);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_Position = projectionMatrix * mv;

  vec2 ndc = gl_Position.xy / gl_Position.w;
  float keep = keepAt(ndc, t);

  // Cursor repulsion, stateless in screen space: pushed away from the lagged mouse (aspect-corrected). The push
  // grows from 0 at the cursor and falls off by smoothstep, so the particles thin out like displaced liquid
  // (no hard-edged hole) and the map stays monotonic for uPush < 1.45 · PUSH_RADIUS (no folds, no knots).
  if (uPush > 0.0) {
    vec2 aspect = vec2(uViewport.x / uViewport.y, 1.0);
    vec2 d = (ndc - uMouse) * aspect;
    float r = length(d);
    if (r < PUSH_RADIUS && r > 1e-5) {
      float f = (r / PUSH_RADIUS) * (1.0 - smoothstep(0.0, PUSH_RADIUS, r));
      gl_Position.xy += (d / r) / aspect * (uPush * f) * gl_Position.w;
    }
  }

  float px = uSize * mix(a.size, b.size, t) * uSizeScale
    * projectionMatrix[1][1] * uBufferHeight * 0.5 / max(depth, 0.001);
  vSize = clamp(px, 1.0, min(32.0 * uDpr, uMaxPoint));
  gl_PointSize = vSize;

  float bokeh = BOKEH_PX * uDpr / max(px, 1e-3);
  vAlpha = clamp(mix(a.alpha, b.alpha, t), 0.0, 1.0) * fade * keep * uOpacity
    * min(px * px, 1.0)                              // sub-pixel points fade instead of sticking at 1 px
    * min(bokeh * bokeh, 1.0)                        // points swollen by nearness spread their ink, not blot
    * smoothstep(0.6, 2.0, depth)                    // near fade
    * smoothstep(0.0, 0.08, abs(uNight - 0.5));      // opacity dips across the blend flip (uNight 0.42–0.58)

  float accent = step(aSeed.y, 0.015);               // 1.5% of particles are signal orange
  vColor = mix(mix(uInk, uMist, uNight), uSignal, max(accent, mix(a.signal, b.signal, t)));
  vSquare = step(0.5, mix(a.square, b.square, t));

  if (depth < 0.3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

// The dust tunnel (spec §4.4; scene.js createDust): drifting specks around the camera path, faded by size and
// nearness, dipped across the ground flip, and kept off the text like the formations (KEEP_OUT_GLSL), so a speck
// passing behind muted copy never takes it under 4.5:1.
export const DUST_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uAlpha;
uniform float uNight;
uniform float uDpr;
uniform float uBufferHeight;
uniform float uMaxPoint;
uniform float uMix;
${KEEP_OUT_GLSL}
attribute vec2 aSeed;
varying float vAlpha;
varying float vSize;
void main() {
  float phase = aSeed.x * 6.2831853;
  vec3 p = position + 0.12 * vec3(sin(uTime * 0.23 + phase), cos(uTime * 0.19 + phase * 1.3), sin(uTime * 0.17 + phase * 0.7));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_Position = projectionMatrix * mv;
  float keep = keepAt(gl_Position.xy / gl_Position.w, uMix);
  float px = uSize * (0.5 + aSeed.y) * projectionMatrix[1][1] * uBufferHeight * 0.5 / max(depth, 0.001);
  vSize = clamp(px, 1.0, min(12.0 * uDpr, uMaxPoint));
  gl_PointSize = vSize;
  vAlpha = uAlpha * (0.4 + 0.6 * aSeed.x) * keep
    * min(px * px, 1.0)                              // sub-pixel dust fades out instead of sticking at 1 px
    * smoothstep(0.6, 2.0, depth)                    // near fade
    * smoothstep(0.0, 0.08, abs(uNight - 0.5));      // opacity dips across the ground flip
  if (depth < 0.3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

export const DUST_FRAGMENT = /* glsl */ `
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

export const PARTICLE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSize;
varying float vSquare;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = vSquare > 0.5 ? max(abs(q.x), abs(q.y)) : length(q);
  if (r > 1.0) discard;
  float a = vAlpha * (1.0 - smoothstep(1.0 - min(2.0 / vSize, 1.0), 1.0, r));   // 1 px feathered edge
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);                                             // premultiplied
}`;
