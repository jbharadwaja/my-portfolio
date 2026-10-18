// Morph resolver (spec §4.3, §4.5). Pure and Node-testable. Boundaries b[0..6] are progress values 0..1:
// b[0] is the entrance (noise → hero), b[1..6] the section boundaries; boundary i morphs formation i → i + 1.

const LAST = 6;
const LAST_SNAP = 0.995;               // the last boundary snaps to 1 so JULIAN always finishes forming
const HANDOFF_EPS = 0.08;              // how close to its shared end a pair must be for a seamless hand-off

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

/**
 * A pair change dips instead of teleporting (fast flick, scrollbar drag, End/Home) unless it is a continuous
 * hand-off: forward, the old pair had (nearly) finished on the formation the new one starts from; backward, the
 * old pair had (nearly) not left the formation the new one ends on. Ruling R40 widens spec §4.3's literal
 * "previous uMix between 0.02 and 0.98" to this, its stated intent: a jump from rest to a far pair dips too.
 */
export function needsDip(prev, next) {
  if (prev.from === next.from && prev.to === next.to) return false;
  const forward = next.from === prev.to && prev.mix >= 1 - HANDOFF_EPS;
  const backward = next.to === prev.from && prev.mix <= HANDOFF_EPS;
  return !(forward || backward);
}

/**
 * Whether `pair` shows formation k (nearly) alone: k is its from side and it has (nearly) not left it, or k is its
 * to side and it has (nearly) arrived. A stand-in (k, k at mix 0) that ends on such a pair is a hand-off (morph.js).
 */
export function showsFormation(pair, k) {
  return (pair.from === k && pair.mix <= HANDOFF_EPS) || (pair.to === k && pair.mix >= 1 - HANDOFF_EPS);
}

/** Moves `current` toward `target` by at most maxPerSec · dt. */
export function limitRate(current, target, maxPerSec, dt) {
  const step = maxPerSec * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}
