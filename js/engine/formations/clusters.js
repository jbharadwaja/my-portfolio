// Formation 4 — eight clusters, one per rail card. Pure. Each blob is an anisotropic gaussian
// (two principal spreads, turned in the view plane, shallow in depth) built around its own local origin; the shader
// places blob `id` at (uClusterX[id], uClusterY) every frame, so the clusters ride above their cards.
import { makeFormation, gauss, fillDust, shuffle } from './common.js';

export const CLUSTERS = 8;
const SHARE = 0.11;                    // of N per blob; the rest (12%) is dust
const MAJOR = { min: 0.5, max: 0.68 }; // gaussian spreads, world units
const MINOR = { min: 0.26, max: 0.4 };
const DEPTH = 0.3;
const MAX_TURN = (25 * Math.PI) / 180;
const TAIL = 2.5;                      // draws are cut at 2.5 σ, so a blob reaches no further than about CLUSTER_BOX
const DUST_RADIUS = 7;

/** One blob's extent (world units): what the Experiments pose frames into the band above a card. */
export const CLUSTER_BOX = { w: 3.6, h: 2.6 };

const lerp = (a, b, t) => a + (b - a) * t;

/** A standard normal draw cut at ±TAIL σ. */
function tail(rng) {
  let g;
  do g = gauss(rng); while (Math.abs(g) > TAIL);
  return g;
}

/** N particles: 8 blobs of round(0.11·N), meta = blob id 0..7; the remaining 12% is dust (meta −1). */
export function buildClusters(N, { rng }) {
  const data = makeFormation(N);
  const per = Math.round(N * SHARE);
  let i = 0;
  for (let id = 0; id < CLUSTERS; id++) {
    const a = lerp(MAJOR.min, MAJOR.max, rng());
    const b = lerp(MINOR.min, MINOR.max, rng());
    const turn = (2 * rng() - 1) * MAX_TURN;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    for (let j = 0; j < per; j++, i++) {
      const u = a * tail(rng);
      const v = b * tail(rng);
      data[i * 4] = u * c - v * s;
      data[i * 4 + 1] = u * s + v * c;
      data[i * 4 + 2] = DEPTH * tail(rng);
      data[i * 4 + 3] = id;
    }
  }
  fillDust(data, i, N, { radius: DUST_RADIUS, rng });
  shuffle(data, 4, rng);               // so any slice of the particles is spread over all eight blobs
  return { data, box: { ...CLUSTER_BOX }, minN: CLUSTERS * 100 };
}
