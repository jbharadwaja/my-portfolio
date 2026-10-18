// Shared helpers for formation builders. Pure and Node-testable: no three.js, no DOM.
// A formation is { data: Float32Array(N·4) of x, y, z, meta in its own centred local frame, box: { w, h }, minN }.

/** Seeded PRNG: a function returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** N particles × (x, y, z, meta), all zero. */
export function makeFormation(N) {
  return new Float32Array(N * 4);
}

/** A standard normal draw (Box–Muller). */
export function gauss(rng) {
  const u = 1 - rng();                 // (0, 1], so the log is finite
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Particles [from, to) become faint dust (meta −1), uniform in a ball of `radius` around the local origin. */
export function fillDust(data, from, to, { radius, rng }) {
  for (let i = from; i < to; i++) {
    const r = radius * Math.cbrt(rng());
    const z = 2 * rng() - 1;
    const a = 2 * Math.PI * rng();
    const s = Math.sqrt(1 - z * z);
    data[i * 4] = r * s * Math.cos(a);
    data[i * 4 + 1] = r * s * Math.sin(a);
    data[i * 4 + 2] = r * z;
    data[i * 4 + 3] = -1;
  }
  return data;
}

/**
 * Systematic resampling over a gw × gh weight grid: one random offset, N evenly spaced draws over the weight CDF,
 * each placed with sub-cell jitter. Returns Float32Array(N·2) of u, v in 0..1 (v grows downward, row-major grid).
 */
export function systematicSample(weights, gw, gh, N, rng) {
  const uv = new Float32Array(N * 2);
  let total = 0;
  let last = -1;                       // the last cell with weight: rounding can never walk past it
  for (let c = 0; c < weights.length; c++) {
    total += weights[c];
    if (weights[c] > 0) last = c;
  }
  if (!(total > 0)) {
    for (let i = 0; i < N * 2; i++) uv[i] = rng();
    return uv;
  }
  const step = total / N;
  const offset = rng();
  let cell = 0;
  let end = weights[0];                // cumulative weight up to the end of `cell`
  for (let i = 0; i < N; i++) {
    const target = (i + offset) * step;
    while (end <= target && cell < last) end += weights[++cell];
    uv[i * 2] = ((cell % gw) + rng()) / gw;
    uv[i * 2 + 1] = (Math.floor(cell / gw) + rng()) / gh;
  }
  return uv;
}

/** Fisher–Yates over records of `stride` floats, in place. */
export function shuffle(data, stride, rng) {
  const n = Math.floor(data.length / stride);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    if (j === i) continue;
    for (let s = 0; s < stride; s++) {
      const t = data[i * stride + s];
      data[i * stride + s] = data[j * stride + s];
      data[j * stride + s] = t;
    }
  }
  return data;
}
