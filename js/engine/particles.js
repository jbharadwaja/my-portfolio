// The formation particles (spec §4.3, §4.5): one THREE.Points of N particles whose geometry has two attribute
// slots, aFrom and aTo. Each formation is one static vec4 BufferAttribute (xyz + meta); changing the pair swaps
// which prebuilt attributes sit in the slots, so a formation uploads once and a swap only rebinds the vertex array.
import { PARTICLE_VERTEX, PARTICLE_FRAGMENT } from './shaders.js';
import { sizeScale } from './density.js';
import { mulberry32 } from './formations/common.js';

const SLOTS = 8;
const SIZE = 0.02;                     // world-unit point size before perspective (≈ 2 CSS px at a section pose)
const SEED = 0x4a42;

/** Raw sRGB components of a #RRGGBB token. */
const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export function createParticles({ THREE, tier, N = tier.N, reduced, spacing = 30 }) {
  const geometry = new THREE.BufferGeometry();
  // three skips a draw without a position attribute; the shader never reads it.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const seed = new Float32Array(N * 2);
  const rng = mulberry32(SEED);
  for (let i = 0; i < seed.length; i++) seed[i] = rng();
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const empty = new THREE.BufferAttribute(new Float32Array(N * 4), 4);
  geometry.setAttribute('aFrom', empty);
  geometry.setAttribute('aTo', empty);

  const uniforms = {
    uMix: { value: 0 },
    uTime: { value: 0 },
    uFrom: { value: 0 },
    uTo: { value: 0 },
    uAlpha: { value: new Float32Array(SLOTS).fill(0.5) },
    uBox: { value: Array.from({ length: SLOTS }, () => new THREE.Vector2(1, 1)) },
    uSize: { value: SIZE },
    uSizeScale: { value: sizeScale(N) },
    uDpr: { value: 1 },
    uBufferHeight: { value: 1 },
    uMaxPoint: { value: 64 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uInk: { value: new THREE.Vector3(...srgb('#0A0A0A')) },
    uMist: { value: new THREE.Vector3(...srgb('#E9E9E4')) },
    uSignal: { value: new THREE.Vector3(...srgb('#FF4D00')) },
    uNight: { value: 0 },
    uOpacity: { value: 1 },
    uPush: { value: 0 },
    uMouse: { value: new THREE.Vector2(9, 9) },
    // Two keep-out rects for each side of the pair: [from a, from b, to a, to b] (scene.js syncUniforms)
    uSafe: { value: Array.from({ length: 4 }, () => new THREE.Vector4(9, 9, 9, 9)) },
    uPulse: { value: 0 },
    uEpoch: { value: 0 },              // Training (Task 11) drives it; the shader does not read it yet
    uHoverCluster: { value: -1 },
    uClusterX: { value: new Float32Array(SLOTS) },
    uClusterY: { value: 0 },
    uRoute: { value: 0 },
    uReticle: { value: new THREE.Vector2(-1, -1) },
    uReduced: { value: reduced ? 1 : 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    defines: { SPACING: spacing.toFixed(1) },
    transparent: true,
    premultipliedAlpha: true,          // constant: it is in the program cache key; only `blending` switches
    blending: THREE.MultiplyBlending,
    depthWrite: false,
    depthTest: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  const slots = new Array(SLOTS).fill(null);

  return {
    points,
    uniforms,
    /** Installs formation k's positions (and its alpha). A rebuild of k rewrites k's attribute in place. */
    setFormation(k, formation, alpha) {
      const { data, box } = formation;
      if (data.length !== N * 4) throw new Error(`formation ${k} has ${data.length / 4} particles, expected ${N}`);
      const attribute = slots[k];
      if (attribute) {
        if (attribute.array !== data) attribute.array.set(data);
        attribute.needsUpdate = true;
      } else {
        slots[k] = new THREE.BufferAttribute(data, 4);
      }
      uniforms.uAlpha.value[k] = alpha;
      uniforms.uBox.value[k].set(box.w, box.h);
    },
    /** Whether formation k has positions to show. */
    has(k) {
      return Boolean(slots[k]);
    },
    bindPair(from, to) {
      if (geometry.attributes.aFrom !== slots[from]) geometry.setAttribute('aFrom', slots[from]);
      if (geometry.attributes.aTo !== slots[to]) geometry.setAttribute('aTo', slots[to]);
      uniforms.uFrom.value = from;
      uniforms.uTo.value = to;
    },
    setMix(mix) {
      uniforms.uMix.value = mix;
    },
    /** Paper multiplies ink in; night adds mist. Read per draw, so switching never recompiles. */
    setBlending(night) {
      material.blending = night ? THREE.AdditiveBlending : THREE.MultiplyBlending;
    },
  };
}
