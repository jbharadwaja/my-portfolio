import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hudResting } from '../js/ui/nav.js';

// Ruling R50: the fixed chrome never covers readable copy. In the hero the section HUD (bottom left) would sit on
// the hero copy — the role line and lead on short landscape phones, the first panel on tablets — so it rests there.
test('the section HUD rests while the hero is current and shows from the encoder on', () => {
  assert.equal(hudResting(0), true, 'hero');
  for (let i = 1; i < 7; i++) assert.equal(hudResting(i), false, `section ${i}`);
});
// Task 9 deferred minor (Task 19 triage): on an upward flick into the hero, a 600 ms fade-out left the chip
// part-opaque over the hero panels as they scrolled under it. It hides at once and still fades in over 600 ms.
test('a resting HUD hides at once and fades back in over 600 ms with the HUD\'s own transition', () => {
  const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
  const rest = css.match(/\.hud\.is-resting\s*\{([^}]*)\}/);
  assert.ok(rest, 'a .hud.is-resting rule');
  assert.match(rest[1], /opacity:\s*0;/);
  // The transition of the state being entered applies: resting lists no opacity, so the hide is instant.
  const restTransition = rest[1].match(/transition:([^;]*);/);
  assert.ok(restTransition, 'the resting rule sets its own transition');
  assert.doesNotMatch(restTransition[1], /opacity|\ball\b/);
  const hud = css.match(/(^|\n)\.hud\s*\{([^}]*)\}/);
  assert.match(hud[2], /transition:[^;]*opacity 600ms/);
});
