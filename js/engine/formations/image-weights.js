// An image → a sampling-weight grid (spec §4.2 row 1). Pure and Node-testable: `image` is ImageData-shaped
// ({ width, height, data: RGBA bytes, not premultiplied }). The portrait (Task 9) uses the defaults; the JULIAN
// glyph mask (Task 15) switches the tone terms off and samples plain coverage.
//
//   g = clamp((0.85 − lum) / 0.70)                  global darkness
//   l = clamp(0.5 + kL · (blur₁₀ − lum))            local contrast (box blur, radius 10 cells)
//   d = (0.5·g + 0.5·l)^gamma                       darkness
//   weight = ((floor + d) + edge · Sobel) · alpha · feather
//
// The local-contrast and Sobel terms read the image as it sits on the page (composited over white), so the
// cut-out's own outline counts as an edge and the transparent surround as light.

const LUMA = [0.2126, 0.7152, 0.0722];   // Rec. 709 weights on the sRGB values
const BLUR_RADIUS = 10;                  // cells

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Global darkness of a luminance 0..1: 1 at ≤ 0.15, 0 at ≥ 0.85. */
const globalDarkness = (lum) => clamp01((0.85 - lum) / 0.7);

/**
 * Returns { weights, gw, gh, lum, dark }: per cell of a gw-wide grid (row-major, y down) the sampling weight, the
 * colour luminance (1 where fully transparent) and the darkness d.
 * featherEdges names the grid edges that ramp to 0 over `feather` of the grid (crop edges that cut the subject).
 */
export function imageWeights(image, {
  gw = 400,
  kL = 4.5,
  gamma = 1.5,
  edge = 1.0,
  floor = 0.03,
  feather = 0.04,
  featherEdges = { top: true, left: true, bottom: true, right: false },
} = {}) {
  const gh = Math.max(1, Math.round((image.height * gw) / image.width));
  const n = gw * gh;
  const alpha = new Float32Array(n);
  const lum = new Float32Array(n);
  resample(image, gw, gh, alpha, lum);

  const paper = new Float32Array(n);     // luminance over white
  for (let i = 0; i < n; i++) paper[i] = lum[i] * alpha[i] + 1 - alpha[i];
  const blur = boxBlur(paper, gw, gh, BLUR_RADIUS);

  const weights = new Float32Array(n);
  const dark = new Float32Array(n);
  const ramp = (t) => (feather > 0 ? Math.min(1, t / feather) : 1);
  for (let y = 0; y < gh; y++) {
    const fy = gh > 1 ? y / (gh - 1) : 0.5;
    const fadeY = (featherEdges.top ? ramp(fy) : 1) * (featherEdges.bottom ? ramp(1 - fy) : 1);
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      const g = globalDarkness(lum[i]);
      const l = clamp01(0.5 + kL * (blur[i] - paper[i]));
      const d = (0.5 * g + 0.5 * l) ** gamma;
      dark[i] = d;
      const a = alpha[i];
      if (!(a > 0)) continue;
      const fx = gw > 1 ? x / (gw - 1) : 0.5;
      const fade = fadeY * (featherEdges.left ? ramp(fx) : 1) * (featherEdges.right ? ramp(1 - fx) : 1);
      weights[i] = (floor + d + edge * sobel(paper, gw, gh, x, y)) * a * fade;
    }
  }
  return { weights, gw, gh, lum, dark };
}

/**
 * Area-averages the image onto the grid (nearest pixel when the grid is finer): alpha, and the colour luminance
 * weighted by alpha (so transparent pixels lend no colour). Cell bounds are exact integer divisions.
 */
function resample({ width, height, data }, gw, gh, alpha, lum) {
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.min(height - 1, Math.floor((gy * height) / gh));
    const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(((gy + 1) * height) / gh)));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.min(width - 1, Math.floor((gx * width) / gw));
      const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(((gx + 1) * width) / gw)));
      let a = 0;
      let la = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4;
          const pa = data[o + 3] / 255;
          a += pa;
          la += pa * (LUMA[0] * data[o] + LUMA[1] * data[o + 1] + LUMA[2] * data[o + 2]) / 255;
        }
      }
      const i = gy * gw + gx;
      alpha[i] = a / ((y1 - y0) * (x1 - x0));
      lum[i] = a > 0 ? la / a : 1;
    }
  }
}

/** Separable box blur with edge clamping (a running sum per row, then per column). */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Sobel gradient magnitude at (x, y), edges clamped, capped at 1 (a full black-to-white step reads 4). */
function sobel(src, w, h, x, y) {
  const xa = Math.max(0, x - 1);
  const xb = Math.min(w - 1, x + 1);
  const ya = Math.max(0, y - 1) * w;
  const yc = y * w;
  const yb = Math.min(h - 1, y + 1) * w;
  const gx = src[ya + xb] + 2 * src[yc + xb] + src[yb + xb] - src[ya + xa] - 2 * src[yc + xa] - src[yb + xa];
  const gy = src[yb + xa] + 2 * src[yb + x] + src[yb + xb] - src[ya + xa] - 2 * src[ya + x] - src[ya + xb];
  return Math.min(1, Math.hypot(gx, gy));
}
