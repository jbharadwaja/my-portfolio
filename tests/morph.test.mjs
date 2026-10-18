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

// A stand-in that ends on a real pair still showing its formation (nearly)
// alone is a hand-off, not a jump — the particles no longer fade out and back in for nothing.
test('an ended stand-in hands off without a dip when the real pair shows the same formation', () => {
  const built = new Set([0, 1, 2, 3]);
  const has = builtOnly(built);
  const s = at(P(2, 3, 1), has);
  stepMorph(s, P(3, 4, 0.02), DT, has);
  assert.deepEqual([s.pair, s.held], [P(3, 3, 0), true]);
  built.add(4);
  assert.equal(stepMorph(s, P(3, 4, 0.05), DT, has), true);
  assert.deepEqual([s.pair, s.held, s.dip, s.opacity], [P(3, 4, 0.05), false, 'none', 1]);
  // Backward: the from side was the one building; the real pair is still (nearly) at its end.
  const back = new Set([5, 6]);
  const hasBack = builtOnly(back);
  const b = at(P(5, 6, 0.03), hasBack);
  stepMorph(b, P(4, 5, 0.97), DT, hasBack);
  assert.deepEqual([b.pair, b.held, b.dip], [P(5, 5, 0), true, 'none']);
  back.add(4);
  assert.equal(stepMorph(b, P(4, 5, 0.94), DT, hasBack), true);
  assert.deepEqual([b.pair, b.held, b.dip, b.opacity], [P(4, 5, 0.94), false, 'none', 1]);
});

test('an ended stand-in on another formation, or held in the middle of its pair, still dips', () => {
  const built = new Set([0, 1, 2, 3]);
  const has = builtOnly(built);
  const s = at(P(2, 3, 1), has);
  stepMorph(s, P(3, 4, 0.2), DT, has);
  built.add(4);
  assert.equal(stepMorph(s, P(3, 4, 0.2), DT, has), false, 'mix 0.2: formation 4 is already half way in');
  assert.equal(s.dip, 'out');
  const t = createMorphState();
  stepMorph(t, P(3, 4, 0.5), DT, builtOnly(new Set([3])));
  assert.deepEqual([t.pair, t.held], [P(3, 3, 0), true]);
  assert.equal(stepMorph(t, P(5, 5, 0), DT, builtOnly(new Set([3, 5]))), false, 'another stand-in');
});

// The pair coming back before the screen has emptied (a flick reversed within 120 ms) no
// longer finishes the dip-out and fades in from 0: the dip turns round where it is, on the pair still bound.
test('a dip-out turns round when the pair comes back: no rebind, fading in from where it was', () => {
  const s = at(P(3, 4, 0.5));
  for (let i = 0; i < 3; i++) assert.equal(stepMorph(s, P(0, 1, 1), DT, all), false);
  const mid = s.opacity;
  assert.ok(mid > 0 && mid < 1);
  assert.equal(stepMorph(s, P(3, 4, 0.52), DT, all), true);
  assert.deepEqual([s.pair, s.dip], [P(3, 4, 0.52), 'in']);
  assert.ok(Math.abs(s.opacity - (mid + DT / DIP_IN_S)) < 1e-12);
  assert.equal(fadeIn(s, P(3, 4, 0.52)) < Math.ceil(DIP_IN_S / DT), true, 'shorter than a full fade-in');
  // A continuous hand-off from the bound pair turns it round too.
  const h = at(P(2, 3, 0.96));
  stepMorph(h, P(5, 6, 0.5), DT, all);
  assert.equal(h.dip, 'out');
  assert.equal(stepMorph(h, P(3, 4, 0.02), DT, all), true);
  assert.deepEqual([h.pair, h.dip], [P(3, 4, 0.02), 'in']);
});

// A far (cut) jump has the canvas faded out already, so the engine rebinds at once on the frame
// after it lands (snapMorph) instead of holding the old pair through its own dip — no ghost as the page fades in.
import { snapMorph } from '../js/engine/morph.js';
test('after snapMorph the next pair binds at once at full opacity, without a dip; one step only', () => {
  const s = at(P(0, 1, 1));
  snapMorph(s);
  assert.equal(stepMorph(s, P(3, 4, 0.5), DT, all), true);
  assert.deepEqual([s.pair, s.dip, s.opacity, s.held], [P(3, 4, 0.5), 'none', 1, false]);
  assert.equal(stepMorph(s, P(0, 1, 1), DT, all), false, 'the next jump dips again');
  assert.equal(s.dip, 'out');
});
test('snapMorph cuts a dip short, and binds a stand-in when the destination is not built yet', () => {
  const built = new Set([0, 1, 5]);
  const has = builtOnly(built);
  const s = at(P(0, 1, 1), has);
  for (let i = 0; i < 3; i++) stepMorph(s, P(2, 3, 0.5), DT, has);   // a dip-out under way (2, 3 unbuilt: held 0)
  snapMorph(s);
  assert.equal(stepMorph(s, P(5, 6, 0.4), DT, has), true);
  assert.deepEqual([s.pair, s.held, s.dip, s.opacity], [P(5, 5, 0), true, 'none', 1]);
  built.add(6);
  dipOut(s, P(5, 6, 0.4), has);                                       // the stand-in ends as before
  assert.deepEqual([s.pair, s.held], [P(5, 6, 0.4), false]);
  const fresh = createMorphState();
  snapMorph(fresh);
  assert.equal(stepMorph(fresh, P(2, 3, 0.1), DT, all), true, 'a first step binds as it always did');
  assert.deepEqual([fresh.pair, fresh.dip, fresh.opacity], [P(2, 3, 0.1), 'none', 1]);
});
