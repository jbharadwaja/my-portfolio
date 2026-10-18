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
test('a resting HUD is transparent, fading with the HUD\'s own opacity transition', () => {
  const css = readFileSync(new URL('../css/main.css', import.meta.url), 'utf8');
  const rest = css.match(/\.hud\.is-resting\s*\{([^}]*)\}/);
  assert.ok(rest, 'a .hud.is-resting rule');
  assert.match(rest[1], /opacity:\s*0;/);
  const hud = css.match(/(^|\n)\.hud\s*\{([^}]*)\}/);
  assert.match(hud[2], /transition:[^;]*opacity/);
});
