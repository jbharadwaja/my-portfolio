// The on-screen pair controller: turns the pair resolved each frame into the pair the particles
// show, with the stand-in for formations still building and the alpha dip for discontinuous pair changes.
// Pure and Node-testable; scene.js binds `state.pair` to the particles after every step.
import { needsDip, showsFormation } from './resolver.js';

export const DIP_OUT_S = 0.12;         // opacity → 0 …
export const DIP_IN_S = 0.24;          // … rebind on the empty frame, → 1

/**
 * `pair` is what the particles show (scene.js passes engine.state.pair). `bound` is false until the first step,
 * which binds without a dip. `held`: the pair stands in for one whose formation is not built yet. `dip`: 'none',
 * 'out' (the old pair fades, then rebinds on an empty frame) or 'in' (fading back). `opacity` multiplies the
 * particles and the dust. `snap`: the next step binds at once (snapMorph).
 */
export function createMorphState(pair = { from: 0, to: 0, mix: 0 }) {
  return { pair, bound: false, held: false, dip: 'none', opacity: 1, snap: false };
}

/**
 * The next step binds whatever pair it resolves at once, at full opacity and with no dip (a dip under way ends):
 * a far jump (scroll.js cut) has the whole canvas faded out already and fades it back in itself, so the engine's
 * own dip would only hold the old formation into the fade-in, a ghost of where the page was.
 */
export function snapMorph(state) {
  state.snap = true;
}

const target = { from: 0, to: 0, mix: 0 };   // scratch: the pair to show this frame (no per-frame allocation)

/**
 * Whether showing `target` instead of the bound pair is continuous: the same pair, a hand-off (needsDip), or a
 * stand-in (k, k) ending on a real pair that still shows k (nearly) alone (showsFormation).
 */
function continuous(state, target) {
  const { pair } = state;
  if (target.from === pair.from && target.to === pair.to) return true;
  return state.held ? showsFormation(target, pair.from) : !needsDip(pair, target);
}

/**
 * One frame. `next` is the resolved pair (read only); `has(k)` says whether formation k is built; dt in seconds.
 * An unbuilt side is stood in for by the built side at mix 0. A pair change that is not continuous (a jump, or a
 * stand-in ending on a pair that has moved on from its formation) dips: the old pair holds while the opacity falls
 * to 0 over DIP_OUT_S, the pair rebinds on that empty frame, and the opacity rises to 1 over DIP_IN_S from the next
 * frame on. If the resolved pair comes back to one continuous with the held pair before the screen is empty (a
 * flick reversed), the dip turns round: no rebind, the opacity rises again from where it was.
 * Writes into `state`; returns false while the dip-out holds the old pair, true when state.pair was updated.
 */
export function stepMorph(state, next, dt, has) {
  const hasFrom = has(next.from);
  const hasTo = has(next.to);
  target.from = next.from;
  target.to = next.to;
  target.mix = next.mix;
  const held = !(hasFrom && hasTo);
  if (held) {
    if (hasFrom) target.to = target.from;
    else if (hasTo) target.from = target.to;
    target.mix = 0;
  }
  const { pair } = state;
  if (state.snap) {
    state.snap = false;
    state.dip = 'none';
    state.opacity = 1;
  } else {
    stepDip(state, continuous(state, target), dt);
    if (state.dip === 'out') return false;
  }
  pair.from = target.from;
  pair.to = target.to;
  pair.mix = target.mix;
  state.held = held;
  state.bound = true;
  return true;
}

/** The dip's part of a step: starts, turns round, fades. Leaves state.dip 'out' while the old pair must hold. */
function stepDip(state, smooth, dt) {
  if (state.bound && state.dip !== 'out' && !smooth) state.dip = 'out';
  else if (state.dip === 'out' && smooth) state.dip = 'in';   // back before the screen emptied: fade in from here
  if (state.dip === 'out') {
    state.opacity = Math.max(0, state.opacity - dt / DIP_OUT_S);
    if (state.opacity > 0) return;
    state.dip = 'in';                  // rebinds on the empty frame; the fade-in starts on the next one
  } else if (state.dip === 'in') {
    state.opacity = Math.min(1, state.opacity + dt / DIP_IN_S);
    if (state.opacity === 1) state.dip = 'none';
  }
}
