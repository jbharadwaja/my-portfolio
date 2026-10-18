// Morph resolver (spec §4.3, §4.5). Pure and Node-testable. Boundaries b[0..6] are progress values 0..1:
// b[0] is the entrance (noise → hero), b[1..6] the section boundaries; boundary i morphs formation i → i + 1.

const LAST = 6;
const LAST_SNAP = 0.995;               // the last boundary snaps to 1 so JULIAN always finishes forming
const DIP_LO = 0.02;
const DIP_HI = 0.98;

/**
 * The pair on screen, from scratch: the last boundary with progress > 0 wins; none → the noise cloud.
 * Writes into `out` when given (no per-frame allocation).
 */
export function resolve(b, out = {}) {
  let i = LAST;
  while (i >= 0 && !(b[i] > 0)) i--;
  if (i < 0) {
    out.from = 0;
    out.to = 1;
    out.mix = 0;
  } else {
    out.from = i;
    out.to = i + 1;
    out.mix = i === LAST && b[i] >= LAST_SNAP ? 1 : b[i];
  }
  return out;
}

/** The entrance is boundary 0; while it runs (< 1) the Hero → Encoder mix is held at 0. Writes into `b`. */
export function applyEntrance(b, entrance) {
  b[0] = Math.min(1, entrance);
  if (entrance < 1) b[1] = 0;
  return b;
}

/** A pair change while the previous mix was mid-morph (fast flick, scrollbar drag) dips instead of teleporting. */
export function needsDip(prev, next) {
  return (prev.from !== next.from || prev.to !== next.to) && prev.mix > DIP_LO && prev.mix < DIP_HI;
}

/** Moves `current` toward `target` by at most maxPerSec · dt. */
export function limitRate(current, target, maxPerSec, dt) {
  const step = maxPerSec * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}
