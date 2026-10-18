// Formation 1 — the portrait. Pure. The cut-out's weight grid (image-weights.js) is
// resampled systematically (one random offset, N evenly spaced draws over the weight CDF) with sub-cell jitter,
// then shuffled so any slice of the particles covers the whole face. Every particle is part of the portrait.
import { makeFormation, systematicSample, shuffle } from './common.js';
import { imageWeights } from './image-weights.js';

const WIDTH = 8;                       // world units across the cut-out; the height follows its aspect
const RELIEF = 0.15;                   // ± z from luminance: lit planes come forward, shadows recede

/** `image` is ImageData-shaped; meta = the cell's darkness d (0..1), which the shader turns into point size. */
export function buildPortrait(N, { image, rng }) {
  const { weights, gw, gh, lum, dark } = imageWeights(image);
  const uv = systematicSample(weights, gw, gh, N, rng);
  const w = WIDTH;
  const h = (WIDTH * gh) / gw;
  const data = makeFormation(N);
  for (let i = 0; i < N; i++) {
    const u = uv[i * 2];
    const v = uv[i * 2 + 1];
    const cell = Math.min(gh - 1, Math.floor(v * gh)) * gw + Math.min(gw - 1, Math.floor(u * gw));
    data[i * 4] = (u - 0.5) * w;
    data[i * 4 + 1] = (0.5 - v) * h;
    data[i * 4 + 2] = RELIEF * (2 * lum[cell] - 1);
    data[i * 4 + 3] = dark[cell];
  }
  shuffle(data, 4, rng);
  return { data, box: { w, h }, minN: 1 };
}
