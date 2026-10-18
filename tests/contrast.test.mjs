import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEEP_OUT_GLSL, PARTICLE_VERTEX, DUST_VERTEX, DUST_FRAGMENT } from '../js/engine/shaders.js';

// Spec §3.1 / §4.5: text sits >= 4.5:1 against what is behind it. The text keep-out greys out whatever drifts
// behind a section's text, and the dust tunnel drifts behind all of it: a dust disc (alpha up to 0.5, up to
// 12·DPR px) under muted ink-60 text left ~2.95:1 (Task 19 review). So the dust takes the same keep-out.

test('the formation particles and the dust tunnel share one text keep-out', () => {
  assert.ok(PARTICLE_VERTEX.includes(KEEP_OUT_GLSL), 'the particles use the shared keep-out');
  assert.ok(DUST_VERTEX.includes(KEEP_OUT_GLSL), 'the dust uses the shared keep-out');
  assert.match(KEEP_OUT_GLSL, /uniform vec4 uSafe\[4\];/);
  assert.match(KEEP_OUT_GLSL, /mix\(0\.12, 1\.0, smoothstep\(0\.0, 32\.0, /, 'x 0.12 inside, a 32 px feather (spec §4.5)');
});

test('the dust alpha is multiplied by the keep-out at its screen position, lerped with the pair mix', () => {
  assert.match(DUST_VERTEX, /uniform float uMix;/);
  assert.match(DUST_VERTEX, /float keep = keepAt\(gl_Position\.xy \/ gl_Position\.w, uMix\);/);
  assert.match(DUST_VERTEX, /vAlpha = [^;]*\* keep\b/);
  // The keep-out is computed after the point is projected, and before the off-clip move of too-near points.
  const order = ['gl_Position = projectionMatrix * mv;', 'float keep = keepAt(', 'if (depth < 0.3)'].map((s) => DUST_VERTEX.indexOf(s));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), `order ${order}`);
  assert.match(DUST_FRAGMENT, /gl_FragColor = vec4\(mix\(uInk, uMist, uNight\) \* a, a\);/, 'premultiplied, as before');
});

// Muted text (ink-60: 5.12:1 on bare paper, 4.5:1 once the paper behind it falls to ~84%) that a formation's dense
// part can pass behind even inside the keep-out, or that no keep-out covers, carries its own paper ground.
const css = (file) => readFileSync(new URL(`../css/${file}`, import.meta.url), 'utf8');
const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[2] ?? null;
};
const grounded = (body) => /background:\s*var\(--bg\);/.test(body ?? '');

test('About: the copy block carries its own paper ground (the galaxy arms pass under the skills, Task 19)', () => {
  assert.ok(grounded(rule(css('sections/about.css'), '.about-text')));
});

test('Work: the subtitle carries its own paper ground (the cluster blobs ride the rail behind the fixed head)', () => {
  // Measured per pixel at 1440 x 900 with the dust hidden: 3.77:1 under a blob's core at the keep-out's 12%.
  assert.ok(grounded(rule(css('sections/experiments.css'), '#work .section-sub')));
});

test('the scroll cue carries its own paper ground in every hero layout, as the denoise HUD does', () => {
  assert.ok(grounded(rule(css('main.css'), '.scroll-cue')));
  assert.ok(grounded(rule(css('main.css'), '.hero-hud')));
});

test('the footer carries the paper ground: no keep-out covers it, and the dust tunnel drifts behind it', () => {
  assert.ok(grounded(rule(css('main.css'), '.site-footer')));
});

test('About: the plate caption carries its own paper ground, hugging its text (the galaxy core is behind the plate)', () => {
  // Measured per pixel at 1024 x 768 at About's end: 4.01:1 under the core's edge at the keep-out's 12%.
  const body = rule(css('sections/about.css'), '.plate-caption');
  assert.ok(grounded(body));
  assert.match(body, /width:\s*fit-content;/);
});
