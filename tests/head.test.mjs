import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CDN = 'https://cdn.jsdelivr.net/npm/';
test('import map pins exact versions', () => {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1]).imports, {
    three: CDN + 'three@0.186.1/build/three.module.js',
    'three/addons/': CDN + 'three@0.186.1/examples/jsm/',
    lenis: CDN + 'lenis@1.3.26/dist/lenis.mjs',
    gsap: CDN + 'gsap@3.15.0/index.js',
    'gsap/ScrollTrigger': CDN + 'gsap@3.15.0/ScrollTrigger.js',
  });
});
test('import map precedes every module script', () => {
  const im = html.indexOf('type="importmap"');
  const mod = html.indexOf('type="module"');
  assert.ok(im > 0 && (mod === -1 || im < mod));
});
test('fonts: both CSS2 links and preconnects', () => {
  assert.ok(html.includes('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Geist+Mono:wght@100..900&display=swap'));
  assert.ok(html.includes('&text=%E2%86%92%E2%86%97%E2%86%90%E2%89%A4&display=swap'));
  assert.ok(html.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'));
});
test('modulepreload for the seven CDN files', () => {
  for (const f of ['three@0.186.1/build/three.module.js', 'three@0.186.1/build/three.core.js', 'gsap@3.15.0/index.js',
    'gsap@3.15.0/gsap-core.js', 'gsap@3.15.0/CSSPlugin.js', 'gsap@3.15.0/ScrollTrigger.js', 'lenis@1.3.26/dist/lenis.mjs'])
    assert.ok(html.includes(`<link rel="modulepreload" href="${CDN}${f}">`), f);
});
test('no-js root and skeleton', () => {
  assert.match(html, /<html lang="en" class="no-js">/);
  assert.match(html, /<canvas id="scene" aria-hidden="true">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<a class="skip" href="#main">/);
});

// Boot sequence (spec §6.1, rulings R15/R23)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const bootStart = html.indexOf('<script>');
test('head order: charset, inline boot script, then stylesheets and the import map', () => {
  const charset = html.indexOf('<meta charset="utf-8">');
  assert.ok(/<head>\s*<meta charset="utf-8">/.test(html), 'charset is the first element in <head>');
  assert.ok(charset >= 0 && charset < 1024, 'charset sits in the first 1024 bytes');
  assert.ok(bootStart > charset, 'inline boot script follows the charset');
  assert.equal(html.indexOf('<script'), bootStart, 'the inline boot script is the first <script>');
  assert.ok(bootStart < html.indexOf('rel="stylesheet"'), 'boot script precedes every stylesheet link');
  assert.ok(bootStart < html.indexOf('type="importmap"'), 'boot script precedes the import map');
});
test('inline boot script is identical to js/boot-inline.js', () => {
  const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  assert.ok(m, 'classic inline script found');
  assert.equal(m[1], read('../js/boot-inline.js').trimEnd());
});
test('veil markup is first in the body: status region, 32 cells, label', () => {
  const body = html.slice(html.indexOf('<body>') + 6);
  assert.match(body.trimStart(), /^<div class="veil" role="status" aria-label="Loading">/);
  const veil = body.slice(0, body.indexOf('<a class="skip"'));
  assert.equal((veil.match(/<i><\/i>/g) || []).length, 32);
  assert.ok(veil.includes('LATENT SPACE') && veil.includes('JB·') && veil.includes('denoising step 00 / 50'));
});
test('veil.js then main.js are the module scripts, after the import map', () => {
  const mods = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(mods, ['js/ui/veil.js', 'js/main.js']);
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('js/ui/veil.js'));
});
test('critical veil CSS: visible only under .js:not(.veil-done), backstop animation, hidden under .no-js', () => {
  assert.match(html, /\.js:not\(\.veil-done\) \.veil \{[^}]*opacity: 1;[^}]*visibility: visible/);
  assert.match(html, /\.js \.veil \{[^}]*animation: veil-out \.6s ease 8s forwards/);
  assert.match(html, /\.js\.veil-done \.veil \{ animation: none; \}/, 'a lifted veil fades by transition; a running backstop animation would cut it short');
  assert.match(html, /\.no-js \.veil \{ display: none; \}/);
  assert.match(html, /@keyframes veil-out \{[^}]*opacity: 0;[^}]*visibility: hidden/);
});
test('the veil text, once shown, inherits the veil\'s visibility: it leaves with the veil (and the accessibility tree)', () => {
  const rule = html.match(/\.veil-text \.veil-head, \.veil-text \.veil-label \{([^}]*)\}/);
  assert.ok(rule, 'a .veil-text rule for the head and label');
  assert.match(rule[1], /visibility: inherit;/, 'visibility: visible would keep LATENT SPACE readable to screen readers under a hidden veil');
});
test('main.css switches transitions off while the page carries .preload (the veil keeps its fade)', () => {
  const css = read('../css/main.css');
  assert.match(css, /\.preload \*:not\(\.veil\),\s*\.preload \*:not\(\.veil\)::before,\s*\.preload \*:not\(\.veil\)::after\s*\{\s*transition: none !important;/);
});

// Ruling R26: no third-party stylesheet can hold up first paint or the module scripts
const FONT_CSS = [
  'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Geist+Mono:wght@100..900&display=swap',
  'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Geist+Mono:wght@100..900&text=%E2%86%92%E2%86%97%E2%86%90%E2%89%A4&display=swap',
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
test('both font stylesheets load without blocking (media=print until onload) and have <noscript> copies', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  for (const href of FONT_CSS) {
    const h = esc(href.replaceAll('&', '&amp;')) + '|' + esc(href);
    assert.match(head, new RegExp(`<link rel="stylesheet" href="(?:${h})" media="print" onload="this\\.media='all'">`), `${href} non-blocking`);
    assert.match(head, new RegExp(`<noscript><link rel="stylesheet" href="(?:${h})"></noscript>`), `${href} noscript copy`);
  }
  const blocking = [...head.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').matchAll(/<link rel="stylesheet" href="([^"]+)"(?![^>]*media="print")/g)].map((m) => m[1]);
  assert.ok(blocking.every((href) => !/^https?:/.test(href)), `only own stylesheets block: ${blocking.join(', ')}`);
});
test('lenis.css is not linked: its rules are inlined in css/main.css', () => {
  assert.doesNotMatch(html, /lenis\.css/);
  const css = read('../css/main.css');
  assert.match(css, /html\.lenis,\s*html\.lenis body \{\s*height: auto;\s*\}/);
  assert.match(css, /\.lenis:not\(\.lenis-autoToggle\)\.lenis-stopped \{\s*overflow: clip;\s*\}/);
  assert.match(css, /\.lenis \[data-lenis-prevent\],[\s\S]*?\{\s*overscroll-behavior: contain;\s*\}/);
  assert.match(css, /\.lenis\.lenis-smooth iframe \{\s*pointer-events: none;\s*\}/);
  assert.match(css, /\.lenis\.lenis-autoToggle \{[^}]*transition-behavior: allow-discrete;/);
});
