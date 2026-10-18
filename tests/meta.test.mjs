import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const nf = readFileSync(new URL('../404.html', import.meta.url), 'utf8');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
test('title and description', () => {
  assert.match(html, /<title>Julian Bharadwaja — Data Scientist &amp; ML Engineer<\/title>|<title>Julian Bharadwaja — Data Scientist & ML Engineer<\/title>/);
  assert.ok(html.includes('content="Julian Bharadwaja — data scientist, ML engineer and data analyst in Tustin, CA. Six ML projects with real metrics and honest verdicts."'));
});
test('canonical, OG, twitter', () => {
  assert.ok(html.includes('<link rel="canonical" href="https://jbharadwaja.github.io/my-portfolio/">'));
  assert.ok(html.includes('property="og:image" content="https://jbharadwaja.github.io/my-portfolio/assets/img/og.png"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
});
test('JSON-LD person', () => {
  const p = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(p['@type'], 'Person'); assert.equal(p.jobTitle, 'Data Scientist');
  assert.ok(p.sameAs.includes('https://www.linkedin.com/in/julian-bharadwaja/') && p.sameAs.includes('https://github.com/jbharadwaja'));
});
test('404 is self-contained', () => {
  assert.ok(nf.includes('Lost in latent space.') && nf.includes('href="/my-portfolio/"') && nf.includes('/my-portfolio/assets/img/favicon.svg'));
  assert.doesNotMatch(nf, /<script/);
});

// Spec §7: the full set of head values, JSON-LD fields and the one-title / one-viewport rule
test('one title and one viewport meta, both early in <head>', () => {
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.equal((html.match(/<meta name="viewport"/g) || []).length, 1);
  assert.ok(head.indexOf('<meta name="viewport"') < head.indexOf('<title>'), 'viewport precedes the title');
});
test('description is also the OG description; og:url, og:title and og:type', () => {
  const desc = 'Julian Bharadwaja — data scientist, ML engineer and data analyst in Tustin, CA. Six ML projects with real metrics and honest verdicts.';
  assert.ok(html.includes(`<meta name="description" content="${desc}">`));
  assert.ok(html.includes(`<meta property="og:description" content="${desc}">`));
  assert.ok(html.includes('<meta property="og:url" content="https://jbharadwaja.github.io/my-portfolio/">'));
  assert.ok(html.includes('<meta property="og:title" content="Julian Bharadwaja — Data Scientist &amp; ML Engineer">'));
  assert.ok(html.includes('<meta property="og:type" content="website">'));
  assert.ok(html.includes('<meta property="og:image:width" content="1200">') && html.includes('<meta property="og:image:height" content="630">'));
});
test('JSON-LD person carries every field of spec §7', () => {
  const p = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(p['@context'], 'https://schema.org');
  assert.equal(p.name, 'Julian Bharadwaja');
  assert.equal(p.url, 'https://jbharadwaja.github.io/my-portfolio/');
  assert.equal(p.email, 'mailto:bharadwajajulian@gmail.com');
  assert.deepEqual(p.address, { '@type': 'PostalAddress', addressLocality: 'Tustin', addressRegion: 'CA', addressCountry: 'US' });
  assert.deepEqual(p.sameAs, ['https://www.linkedin.com/in/julian-bharadwaja/', 'https://github.com/jbharadwaja']);
  assert.deepEqual(p.alumniOf.map((a) => a.name), ['Asian Institute of Technology', 'Orange Coast College']);
  assert.ok(p.alumniOf.every((a) => a['@type'] === 'CollegeOrUniversity'));
});

// Spec §6.1 step 5 and ruling R32: the module graph is preloaded
const ownModules = (dir = '../js/') => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? ownModules(`${dir}${e.name}/`) : e.name.endsWith('.js') ? [`${dir.slice(3)}${e.name}`] : []);
test('every own JS module is modulepreloaded (boot-inline.js is the inline script\'s reference copy, not a module)', () => {
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="(js\/[^"]+)">/g)].map((m) => m[1]).sort();
  const modules = ownModules().filter((m) => m !== 'js/boot-inline.js').sort();
  assert.ok(modules.length > 30, 'the walk found the modules');
  assert.deepEqual(preloaded, modules);
});
test('own modulepreloads follow the import map', () => {
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('<link rel="modulepreload" href="js/'));
});
test('gsap Observer.js is preloaded (ScrollTrigger imports it)', () => {
  assert.ok(html.includes('<link rel="modulepreload" href="https://cdn.jsdelivr.net/npm/gsap@3.15.0/Observer.js">'));
});

// Ruling R17: every section is a named landmark
test('every section is labelled by a heading inside it', () => {
  const sections = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)].map((m) => m[0]);
  assert.equal(sections.length, 7);
  for (const s of sections) {
    const id = s.match(/^<section\b[^>]*\sid="([^"]+)"/)[1];
    const ref = s.match(/^<section\b[^>]*\saria-labelledby="([^"]+)"/)?.[1];
    assert.ok(ref, `${id} has aria-labelledby`);
    assert.match(s, new RegExp(`<h[12]\\b[^>]*\\sid="${ref}"`), `${id}: #${ref} is a heading in the section`);
    assert.equal((html.match(new RegExp(`\\sid="${ref}"`, 'g')) || []).length, 1, `#${ref} is unique`);
  }
  assert.match(html, /<section id="top"[^>]*aria-labelledby="hero-name"/);
});

// Ruling R32: only the jump targets lose their focus ring
test('the no-ring rule covers the nav jump targets only', () => {
  const css = read('../css/main.css');
  assert.doesNotMatch(css, /^\[tabindex="-1"\]:focus/m, 'no global tabindex=-1 rule');
  assert.match(css, /^main:focus, main > section:focus \{ outline: none; \}/m);
});

// Ruling R23
test('.gitignore ignores .DS_Store', () => {
  assert.ok(existsSync(new URL('../.gitignore', import.meta.url)));
  assert.match(read('../.gitignore'), /^\.DS_Store$/m);
});

// og.png: 1200 x 630 (PNG header: signature, then the IHDR width and height)
test('og.png is a 1200 x 630 PNG', () => {
  const png = readFileSync(new URL('../assets/img/og.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

// 404.html (spec §7): the only file with absolute paths
test('404 copy, fonts and favicon', () => {
  assert.match(nf, /<p class="eyebrow">404 · not in the latent space<\/p>/);
  assert.match(nf, /<h1>Lost in latent space\.<\/h1>/);
  assert.match(nf, /<a href="\/my-portfolio\/">← back to the portfolio<\/a>/);
  assert.ok(nf.includes('<link rel="icon" href="/my-portfolio/assets/img/favicon.svg" type="image/svg+xml">'));
  assert.ok(nf.includes('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Geist+Mono:wght@100..900&display=swap'));
  assert.ok(nf.includes('&text=%E2%86%92%E2%86%97%E2%86%90%E2%89%A4&display=swap'));
  assert.ok(nf.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'));
});
test('404 is a complete document with no local stylesheets, scripts or relative paths', () => {
  assert.match(nf, /^<!doctype html>\n<html lang="en">/);
  assert.match(nf, /<meta charset="utf-8">/);
  assert.match(nf, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(nf, /<title>[^<]+<\/title>/);
  assert.doesNotMatch(nf, /<link rel="stylesheet" href="(?!https:)/);
  assert.doesNotMatch(nf, /(?:href|src)="(?!https:|\/my-portfolio\/|#)[^"]*"/, 'every href/src is absolute');
});
test('404 uses the spec tokens: paper ground, ink type, orange never as text', () => {
  const css = nf.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(css.includes('--c-paper:   #F6F6F3') && css.includes('--c-ink:     #0A0A0A') && css.includes('--c-signal:  #FF4D00'));
  assert.doesNotMatch(css.replace(/--c-signal[^;]*;/g, ''), /(?:^|[;{\s])color:[^;]*(?:accent|signal)/);
});

test('404: the way back is a full-size tap target that keeps its place (padding cancelled by margin, >= 24 px, WCAG 2.5.8)', () => {
  const css = nf.match(/<style>([\s\S]*?)<\/style>/)[1];
  const rule = css.match(/(^|\n)a \{([^}]*)\}/)[2];
  assert.match(rule, /display: inline-block;/);
  const pad = Number(rule.match(/padding-block: (\d+)px;/)?.[1]);
  assert.ok(pad >= 12, `padding-block ${pad}px: the 13 px label line grows to at least 24 px plus air`);
  assert.match(rule, new RegExp(`margin-block: -${pad}px;`), 'the padding does not move the link');
});
// README
test('README documents local dev, tests, debug flags, asset tools and deploy', () => {
  const md = read('../README.md');
  for (const needle of ['python3 -m http.server', 'npm test', '?debug', '?nowebgl', '?simulate=cdnfail', '?simulate=hang',
    'cutout.swift', 'bake-worldmap.mjs', 'GitHub Pages', '404.html', '.nojekyll']) assert.ok(md.includes(needle), needle);
});
test('README Tests table lists every suite in tests/, and only those', () => {
  const md = read('../README.md');
  const section = md.slice(md.indexOf('## Tests'), md.indexOf('## Debug flags'));
  const listed = [...section.matchAll(/^\| `([\w-]+)` \|/gm)].map((m) => m[1]).sort();
  const suites = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.test.mjs')).map((f) => f.slice(0, -'.test.mjs'.length)).sort();
  assert.deepEqual(listed, suites);
});
test('README layout names the off-page strings module and the ~ console', () => {
  const md = read('../README.md');
  const layout = md.slice(md.indexOf('## Layout'), md.indexOf('## Local development'));
  assert.match(layout, /^js\/content\.js\s/m);
  assert.match(layout, /^js\/ui\/.*~ console/m);
});

// Assets (final review: the unused cut-out JPEG is gone; every image the repository ships has a user)
const IMG = new URL('../assets/img/', import.meta.url);
const walk = (dir) => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]);
test('portrait-cutout.jpg is gone, and no JPEG ships in assets/img', () => {
  assert.ok(!existsSync(new URL('portrait-cutout.jpg', IMG)));
  assert.deepEqual(readdirSync(IMG).filter((f) => /\.jpe?g$/i.test(f)), []);
});
test('every file in assets/img is used by the page, the 404 page, a script or a stylesheet', () => {
  const sources = [html, nf, ...walk('../js/').concat(walk('../css/')).map((p) => read(p))].join('\n');
  const files = readdirSync(IMG).filter((f) => !f.startsWith('.'));
  assert.ok(files.length >= 4, 'the directory was read');
  for (const f of files) assert.ok(sources.includes(`assets/img/${f}`), `${f} is referenced`);
});

// A minimal PNG reader for the icon checks: 8-bit RGB or RGBA, not interlaced (what Chrome's screenshots and our icons are)
function readPng(buf) {
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG');
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20), depth = buf[24], type = buf[25], interlace = buf[28];
  assert.equal(depth, 8, '8-bit'); assert.equal(interlace, 0, 'not interlaced');
  assert.ok(type === 2 || type === 6, `RGB or RGBA, got colour type ${type}`);
  const bpp = type === 6 ? 4 : 3;
  const idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at), name = buf.subarray(at + 4, at + 8).toString('latin1');
    if (name === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * bpp, px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = i >= bpp && y ? px[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + i] = (line[i] + pred) & 255;
    }
  }
  return { width, height, type, at: (x, y) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + bpp)] };
}
const png = (name) => readPng(readFileSync(new URL(name, IMG)));
const dark = (p) => p[0] < 60 && p[1] < 60 && p[2] < 60;
const PAPER = [0xf6, 0xf6, 0xf3];

test('apple-touch-icon.png is 180 x 180, opaque (iOS paints transparency black), paper ground with the ink mark', () => {
  const icon = png('apple-touch-icon.png');
  assert.deepEqual([icon.width, icon.height], [180, 180]);
  for (const [x, y] of [[0, 0], [179, 0], [0, 179], [179, 179]]) {
    const p = icon.at(x, y);
    assert.deepEqual(p.slice(0, 3), PAPER, `corner ${x},${y} is paper`);
    if (icon.type === 6) assert.equal(p[3], 255, `corner ${x},${y} is opaque`);
  }
  let ink = 0;
  for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) if (dark(icon.at(x, y))) ink++;
  assert.ok(ink > 1500 && ink < 12000, `the JB mark is drawn (${ink} ink pixels)`);
});
test('favicon-32.png is 32 x 32 and draws the mark on paper', () => {
  const icon = png('favicon-32.png');
  assert.deepEqual([icon.width, icon.height], [32, 32]);
  let ink = 0, paper = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const p = icon.at(x, y);
    if (dark(p)) ink++;
    if (p[0] > 235 && p[1] > 235 && p[2] > 232 && (p[3] ?? 255) === 255) paper++;
  }
  assert.ok(ink > 40 && paper > 300, `ink ${ink}, paper ${paper}`);
});
test('index.html offers the SVG icon, the 32 px PNG fallback and the apple-touch-icon, with relative paths', () => {
  assert.ok(head.includes('<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">'));
  assert.ok(head.includes('<link rel="icon" href="assets/img/favicon-32.png" type="image/png" sizes="32x32">'));
  assert.ok(head.includes('<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">'));
});
test('404.html offers the same icons, with absolute /my-portfolio/ paths', () => {
  assert.ok(nf.includes('<link rel="icon" href="/my-portfolio/assets/img/favicon.svg" type="image/svg+xml">'));
  assert.ok(nf.includes('<link rel="icon" href="/my-portfolio/assets/img/favicon-32.png" type="image/png" sizes="32x32">'));
  assert.ok(nf.includes('<link rel="apple-touch-icon" href="/my-portfolio/assets/img/apple-touch-icon.png">'));
});
