// Camera framing. Pure and Node-testable. Rects are CSS px in the viewport (y down); world units
// are the formation's. The camera looks straight down −z, so framing a box is a distance plus a lateral shift.

export const FRAME_SLACK = 1.08;   // breathing room around the box

const halfTan = (vfovDeg) => Math.tan((vfovDeg * Math.PI) / 360);

/** Camera distance at which a box `w × h` (world units) fills the target rect, whichever axis binds. */
export function frameDistance(box, rect, vw, vh, vfovDeg) {
  const tan = halfTan(vfovDeg);
  const aspect = vw / vh;
  const byHeight = (box.h / 2 / tan) * (vh / rect.h);
  const byWidth = (box.w / 2 / (tan * aspect)) * (vw / rect.w);
  return FRAME_SLACK * Math.max(byHeight, byWidth);
}

/** Camera offset (world units, at `distance`) that projects the box centre onto the rect centre. */
export function rectShift(rect, vw, vh, distance, vfovDeg, out = { dx: 0, dy: 0 }) {
  const halfH = distance * halfTan(vfovDeg);
  const ndcX = ((rect.x + rect.w / 2) / vw) * 2 - 1;
  const ndcY = 1 - ((rect.y + rect.h / 2) / vh) * 2;
  out.dx = -ndcX * halfH * (vw / vh);
  out.dy = -ndcY * halfH;
  return out;
}

/** Linear blend of two camera poses `{ x, y, z, roll }`; writes into `out` when given (no per-frame allocation). */
export function lerpPose(a, b, t, out = {}) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.roll = a.roll + (b.roll - a.roll) * t;
  return out;
}
