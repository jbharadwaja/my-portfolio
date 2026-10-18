// Formation 6 — a loose two-arm spiral (About). Pure. The disc is built in its own plane, then tilted
// and turned so the camera, looking down −z, sees an inclined spiral rather than a flat ring.
import { makeFormation, gauss, shuffle } from './common.js';

const RADIUS = 4.2;                    // outer arm radius
const R0 = 0.35;                       // where the arms leave the bulge
const PITCH = Math.tan((21 * Math.PI) / 180);   // logarithmic spiral r = R0·e^(PITCH·θ): just over one turn
const SHARE = { bulge: 0.06, arms: 0.76 };      // the rest is the diffuse disc
const TILT = (50 * Math.PI) / 180;     // inclination about x
const TURN = (-24 * Math.PI) / 180;    // then a turn about the view axis
const DEPTH = 0.3;                     // the tilt's depth is flattened so perspective does not balloon the near side

const percentile = (values, q) => {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

export function buildGalaxy(N, { rng }) {
  const data = makeFormation(N);
  const nBulge = Math.round(N * SHARE.bulge);
  const nArms = Math.round(N * SHARE.arms);
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  const cr = Math.cos(TURN);
  const sr = Math.sin(TURN);
  const absX = new Float32Array(N);
  const absY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let x;
    let y;
    let z;
    if (i < nBulge) {
      x = 0.55 * gauss(rng);
      y = 0.55 * gauss(rng);
      z = 0.3 * gauss(rng);
    } else if (i < nBulge + nArms) {
      // Evenly along an arm; the scatter widens outward so the arms stay loose.
      const r = R0 + (RADIUS - R0) * rng();
      const theta = Math.log(r / R0) / PITCH + (i % 2) * Math.PI + (0.15 * gauss(rng)) / Math.sqrt(r);
      const spread = 0.07 + 0.05 * r;
      x = r * Math.cos(theta) + spread * gauss(rng);
      y = r * Math.sin(theta) + spread * gauss(rng);
      z = (0.16 - 0.02 * r) * gauss(rng);
    } else {
      // Diffuse exponential disc between and beyond the arms.
      const r = Math.min(RADIUS * 1.15, -1.5 * Math.log(1 - rng()));
      const a = 2 * Math.PI * rng();
      x = r * Math.cos(a);
      y = r * Math.sin(a);
      z = 0.14 * gauss(rng);
    }
    const ty = y * ct - z * st;        // tilt about x
    const tz = y * st + z * ct;
    data[i * 4] = x * cr - ty * sr;    // turn about z
    data[i * 4 + 1] = x * sr + ty * cr;
    data[i * 4 + 2] = tz * DEPTH;
    absX[i] = Math.abs(data[i * 4]);
    absY[i] = Math.abs(data[i * 4 + 1]);
  }
  shuffle(data, 4, rng);               // so any slice of the particles is spread over the whole galaxy
  return { data, box: { w: 2 * percentile(absX, 0.995), h: 2 * percentile(absY, 0.995) }, minN: 1 };
}
