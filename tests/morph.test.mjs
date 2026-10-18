import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMorphState, stepMorph, DIP_OUT_S, DIP_IN_S } from '../js/engine/morph.js';

const DT = 1 / 60;
const P = (from, to, mix) => ({ from, to, mix });
const all = () => true;
const builtOnly = (set) => (k) => set.has(k);

/** A state already showing `pair` (its first step binds without a dip). */
function at(pair, has = all) {
  const s = createMorphState();
  stepMorph(s, pair, DT, has);
  assert.deepEqual([s.pair, s.dip, s.opacity], [pair, 'none', 1]);
  return s;
}

/** Steps toward `next` until the rebind; returns the frames it took and the opacities on the way. */
function dipOut(s, next, has = all) {
  const opacities = [];
  for (let frames = 1; frames <= 100; frames++) {
    const before = { ...s.pair };
    if (stepMorph(s, next, DT, has)) return { frames, opacities };
    assert.deepEqual(s.pair, before, 'the old pair holds while the screen empties');
    opacities.push(s.opacity);
  }
  throw new Error('never rebound');
}

/** Steps (the pair unchanged) until the fade-in ends; returns the frames it took. */
function fadeIn(s, next, has = all) {
  for (let frames = 1; frames <= 100; frames++) {
    assert.equal(stepMorph(s, next, DT, has), true);
    if (s.dip === 'none') return frames;
  }
  throw new Error('never faded in');
}

test('the first step binds without a dip', () => {
  const s = createMorphState();
  assert.equal(stepMorph(s, P(0, 1, 1), DT, all), true);
  assert.deepEqual([s.pair, s.dip, s.opacity, s.held], [P(0, 1, 1), 'none', 1, false]);
});

test('a jump from rest to a far pair dips: 0 in 120 ms, rebind on the empty frame, 1 in 240 ms', () => {
  const s = at(P(0, 1, 1));
  const out = dipOut(s, P(3, 4, 0.5));
  // Opacity falls every frame and the pair rebinds on the first frame it reaches 0 (at 60 Hz: frame 8 = 133 ms).
  assert.equal(out.frames, Math.ceil(DIP_OUT_S / DT));
  assert.ok(out.opacities.every((o, i) => o > 0 && o < (i ? out.opacities[i - 1] : 1)));
  assert.ok(out.frames * DT >= DIP_OUT_S && (out.frames - 1) * DT < DIP_OUT_S);
  assert.deepEqual([s.pair, s.dip, s.opacity], [P(3, 4, 0.5), 'in', 0]);
  // The fade-in starts on the frame after the rebind (at 60 Hz: 15 frames = 250 ms).
  const frames = fadeIn(s, P(3, 4, 0.5));
  assert.equal(frames, Math.ceil(DIP_IN_S / DT));
  assert.deepEqual([s.pair, s.dip, s.opacity], [P(3, 4, 0.5), 'none', 1]);
});

test('a continuous hand-off rebinds at once, without a dip', () => {
  const forward = at(P(2, 3, 0.97));
  assert.equal(stepMorph(forward, P(3, 4, 0.03), DT, all), true);
  assert.deepEqual([forward.pair, forward.dip, forward.opacity], [P(3, 4, 0.03), 'none', 1]);
  const backward = at(P(5, 6, 0.03));
  assert.equal(stepMorph(backward, P(4, 5, 1), DT, all), true);
  assert.deepEqual([backward.pair, backward.dip, backward.opacity], [P(4, 5, 1), 'none', 1]);
});

test('mix changes within a pair never dip', () => {
  const s = at(P(3, 4, 0.1));
  stepMorph(s, P(3, 4, 0.9), DT, all);
  assert.deepEqual([s.pair, s.dip, s.opacity], [P(3, 4, 0.9), 'none', 1]);
});

test('an unbuilt formation is stood in for by the built side, then dips in once it is built', () => {
  const built = new Set([0, 1, 2, 3]);
  const has = builtOnly(built);
  const s = at(P(2, 3, 1), has);
  // Forward into 3 → 4 while 4 is still building: formation 3 holds at mix 0 (a hand-off: same formation shown).
  assert.equal(stepMorph(s, P(3, 4, 0.5), DT, has), true);
  assert.deepEqual([s.pair, s.held, s.dip, s.opacity], [P(3, 3, 0), true, 'none', 1]);
  for (let i = 0; i < 5; i++) stepMorph(s, P(3, 4, 0.6), DT, has);
  assert.deepEqual([s.pair, s.held, s.opacity], [P(3, 3, 0), true, 1]);
  // Built: the stand-in ends with a dip into the real pair.
  built.add(4);
  const out = dipOut(s, P(3, 4, 0.6), has);
  assert.equal(out.frames, Math.ceil(DIP_OUT_S / DT));
  assert.deepEqual([s.pair, s.held, s.dip, s.opacity], [P(3, 4, 0.6), false, 'in', 0]);
  assert.equal(fadeIn(s, P(3, 4, 0.6), has), Math.ceil(DIP_IN_S / DT));
});

test('a far jump into an unbuilt pair dips into the stand-in, then dips again into the real pair', () => {
  const built = new Set([0, 1, 5]);
  const has = builtOnly(built);
  const s = at(P(0, 1, 1), has);
  dipOut(s, P(5, 6, 0.4), has);
  assert.deepEqual([s.pair, s.held, s.dip], [P(5, 5, 0), true, 'in']);
  fadeIn(s, P(5, 6, 0.4), has);
  built.add(6);
  dipOut(s, P(5, 6, 0.4), has);
  assert.deepEqual([s.pair, s.held, s.dip], [P(5, 6, 0.4), false, 'in']);
});

test('neither side built: the pair is held at mix 0 (scene.js hides the particles)', () => {
  const s = createMorphState();
  stepMorph(s, P(2, 3, 0.5), DT, () => false);
  assert.deepEqual([s.pair, s.held], [P(2, 3, 0), true]);
});

test('the pair resolved last during the dip-out is the one bound', () => {
  const s = at(P(0, 1, 1));
  for (let i = 0; i < 3; i++) assert.equal(stepMorph(s, P(3, 4, 0.5), DT, all), false);
  const out = dipOut(s, P(4, 5, 0.2));
  assert.equal(out.frames + 3, Math.ceil(DIP_OUT_S / DT));      // the dip-out does not restart
  assert.deepEqual(s.pair, P(4, 5, 0.2));
});

test('a jump during the fade-in dips out again from the current opacity; a hand-off keeps fading in', () => {
  const s = at(P(0, 1, 1));
  dipOut(s, P(3, 4, 0.5));
  for (let i = 0; i < 6; i++) stepMorph(s, P(3, 4, 0.5), DT, all);
  const mid = s.opacity;
  assert.ok(mid > 0.3 && mid < 0.5);
  assert.equal(stepMorph(s, P(3, 4, 0.99), DT, all), true);
  assert.equal(stepMorph(s, P(4, 5, 0.01), DT, all), true);      // hand-off: rebinds, still fading in
  assert.deepEqual([s.pair, s.dip], [P(4, 5, 0.01), 'in']);
  const before = s.opacity;
  assert.equal(stepMorph(s, P(0, 1, 1), DT, all), false);        // Home: out again, from where it was
  assert.equal(s.dip, 'out');
  assert.ok(Math.abs(s.opacity - (before - DT / DIP_OUT_S)) < 1e-12);
});

test('a zero-length frame (resync) holds the dip where it is', () => {
  const s = at(P(0, 1, 1));
  stepMorph(s, P(3, 4, 0.5), DT, all);
  const o = s.opacity;
  assert.equal(stepMorph(s, P(3, 4, 0.5), 0, all), false);
  assert.equal(s.opacity, o);
});
