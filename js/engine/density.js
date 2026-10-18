// Density control. Pure and Node-testable. Multiply blending compounds: six overlapping ink points at
// a = 0.5 leave ~2% of the paper, so each formation's alpha is set from how much it overlaps at its own pose.

const K = 1.9;                         // alpha · overlap at the 99th percentile → that spot keeps ~16% of the paper
const ALPHA_MIN = 0.06;
const ALPHA_MAX = 0.85;
const REFERENCE_N = 48000;
const MAX_SIZE_SCALE = 2;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Alpha for a formation from its projected points (NDC pairs). Points inside [−1, 1]² are binned into a
 * grid × grid histogram; k = the 99th percentile (nearest rank) of the occupied cells' counts.
 * `footprint` (default 1) is one point's screen area as a fraction of a cell: k · footprint is then the overlap
 * per pixel the 1.9 is calibrated for. With the default the count itself is the overlap.
 */
export function alphaForPoints(ndc, grid = 64, footprint = 1) {
  const hist = new Uint32Array(grid * grid);
  for (let i = 0; i + 1 < ndc.length; i += 2) {
    const x = ndc[i];
    const y = ndc[i + 1];
    if (!(x >= -1 && x <= 1 && y >= -1 && y <= 1)) continue;
    const cx = Math.min(grid - 1, Math.floor(((x + 1) / 2) * grid));
    const cy = Math.min(grid - 1, Math.floor(((y + 1) / 2) * grid));
    hist[cy * grid + cx]++;
  }
  const occupied = hist.filter((c) => c > 0).sort();
  if (occupied.length === 0) return ALPHA_MAX;
  const k = occupied[Math.ceil(0.99 * occupied.length) - 1] * footprint;
  return clamp(K / k, ALPHA_MIN, ALPHA_MAX);
}

/** Point-size multiplier so coverage does not depend on the tier's particle count. */
export function sizeScale(N) {
  return Math.min(MAX_SIZE_SCALE, Math.sqrt(REFERENCE_N / N));
}
