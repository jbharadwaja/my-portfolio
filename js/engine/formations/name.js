// Formation 7 — the name. Pure. `image` is the word drawn in ink on a transparent canvas, tight
// to the glyphs (ImageData-shaped); 85% of N is sampled from its coverage, the rest becomes faint dust.
import { makeFormation, fillDust, systematicSample, shuffle } from './common.js';
import { imageWeights } from './image-weights.js';

const WIDTH = 10;                      // world units across the word; the height follows the image
const GLYPH_SHARE = 0.85;
const DUST_RADIUS = 4.5;               // a ball around the word's centre
const MIN_N = 2000;                    // fewer glyph points than this stop reading as letters
// Plain coverage: the local-contrast, edge and floor terms are off, so for ink drawn in black (global darkness 1)
// the weight is the alpha times a constant, and every part of a letter is equally dense.
const COVERAGE = { kL: 0, gamma: 1, edge: 0, floor: 0, featherEdges: {} };

/** meta = 0 for the word's points (the shader sizes them alike) and −1 for the dust. */
export function buildName(N, { image, rng }) {
  const { weights, gw, gh } = imageWeights(image, COVERAGE);
  const nGlyph = Math.round(N * GLYPH_SHARE);
  const uv = systematicSample(weights, gw, gh, nGlyph, rng);
  const w = WIDTH;
  const h = (WIDTH * image.height) / image.width;
  const data = makeFormation(N);
  for (let i = 0; i < nGlyph; i++) {
    data[i * 4] = (uv[i * 2] - 0.5) * w;
    data[i * 4 + 1] = (0.5 - uv[i * 2 + 1]) * h;
  }
  fillDust(data, nGlyph, N, { radius: DUST_RADIUS, rng });
  shuffle(data, 4, rng);               // so any slice of the particles covers the whole word
  return { data, box: { w, h }, minN: MIN_N };
}
