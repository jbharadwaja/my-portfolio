// Formation 0 — the noise cloud the hero denoises from: a 3D gaussian, σ = 2.2. Pure.
import { makeFormation, gauss } from './common.js';

const SIGMA = 2.2;

export function buildNoise(N, { rng }) {
  const data = makeFormation(N);
  for (let i = 0; i < N; i++) {
    data[i * 4] = SIGMA * gauss(rng);
    data[i * 4 + 1] = SIGMA * gauss(rng);
    data[i * 4 + 2] = SIGMA * gauss(rng);
  }
  // ±2σ frames the body of the cloud; the gaussian tail drifts past the edges.
  return { data, box: { w: 4 * SIGMA, h: 4 * SIGMA }, minN: 1 };
}
