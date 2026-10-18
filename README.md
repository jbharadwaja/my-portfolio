# Julian Bharadwaja — Latent Space

The portfolio of Julian Bharadwaja, data scientist and ML engineer in Tustin, CA.
Live at <https://jbharadwaja.github.io/my-portfolio/>.

One particle field fills the screen and the camera flies through it. The field re-forms for each section:
a portrait in the hero, a neural network, a training run, a rail of six ML projects and two field analyses, a
route across four countries on a night ground, and a signed-off name. Every project states its result against
a target or baseline, with an honest verdict.

The site is plain HTML, CSS and ES modules. There is **no build step** and nothing to install: the files in this
repository are the files that GitHub Pages serves. three.js, GSAP + ScrollTrigger and Lenis load from jsDelivr
through an import map at exact pinned versions (three 0.186.1, GSAP 3.15.0, Lenis 1.3.26); fonts (Archivo,
Geist Mono) load from Google Fonts. Without JavaScript the page reads top to bottom as a one-page resume.

## Layout

```
index.html        all page copy (the single source), head meta, JSON-LD, import map, module preloads
404.html          self-contained error page (inline CSS, no JS; the one file that uses absolute paths)
css/main.css      tokens, type, layout, components; css/sections/*.css one stylesheet per section
js/main.js        boot: tier, dynamic imports, scroll, sections
js/engine/        WebGL particle engine: scene, particles, shaders, morph, resolver, formations/
js/sections/      scroll wiring and DOM for the hero and each section
js/ui/            veil, scroll (the only door to scrolling), nav, split text, cursor, halftone reveal
js/data/          baked world-map dot lattice
assets/img/       portraits, favicon, og.png (the social preview, 1200 × 630)
tests/            node:test suites
.nojekyll         tells GitHub Pages to serve the files as they are
```

## Local development

From this directory:

```sh
python3 -m http.server 5173
```

Then open <http://localhost:5173/>. The page needs a network connection for the CDN libraries and fonts.
Use a plain static server: `file://` does not work, because ES modules and the import map need HTTP.

`http.server` lets the browser cache modules and stylesheets. While editing, a server that sends
`Cache-Control: no-store` avoids stale files; the project folder around this repository keeps one:
`python3 ../tools/serve.py --dir . --port 5173`.

## Tests

```sh
npm test
```

This runs `node --test "tests/**/*.test.mjs"` (Node 22 or newer). There are no dependencies to install;
`package.json` exists only for `"type": "module"` and the test script. The tests cover the pure modules (tier
choice, camera framing, resolver, density, geometry, formations, scroll maths, text splitting) and the markup
contract in `index.html` and `404.html` (copy, head meta, preloads, landmarks).

## Debug flags

Query flags, harmless in production:

| Flag | Effect |
|---|---|
| `?debug` | Overlay with the tier, particle count, DPR, fps and the current morph pair (from, to, mix). |
| `?nowebgl` | Behave as if WebGL were unavailable: the no-WebGL fallbacks (static halftone portrait, label grid, 2D map). |
| `?simulate=cdnfail` | A CDN import fails: the banner names the URL, the veil still lifts, scrolling is native. |
| `?simulate=hang` | Boot never signals ready: the 8 s cap lifts the veil. |

The loading veil never hangs: it lifts by 8.6 s whatever fails (CDN down, JavaScript off, WebGL missing).

## Asset tools

Kept beside this repository in the project folder (`tools/`), outside it and not deployed. The generated
files they write are committed here.

- `tools/cutout.swift` — offline subject cut-out with Apple Vision (macOS 14+). Build once with
  `swiftc -O tools/cutout.swift -o tools/cutout`, then
  `tools/cutout photo.jpg outdir [--crop x,y,w,h] [--keep-bg] [--flatten F6F6F3]`. The cut-out PNG is encoded to
  `assets/img/portrait-cutout.webp` with `cwebp -q 80 -alpha_q 100 -m 6 -sharp_yuv`; the flattened JPEG is the
  no-WebP fallback; `--keep-bg` makes the uncut About photo.
- `tools/bake-worldmap.mjs` — zero-dependency Node script that turns the `world-atlas` land TopoJSON into the dot
  lattice in `js/data/worldmap-dots.js`:
  `node tools/bake-worldmap.mjs --cols 260 --lon0 150 --latN 75 --latS -58 --module my-portfolio/js/data/worldmap-dots.js`.
- `tools/serve.py` — the no-store dev server described above.

`assets/img/og.png` is a 1200 × 630 screenshot of the hero after the entrance (portrait formed, veil gone).
Regenerate it whenever the hero changes.

## Deploy

GitHub Pages serves the `main` branch of `jbharadwaja/my-portfolio` as it is: no workflow, no build.

1. Replace the repository contents with this site in one commit (the old site stays in git history).
2. Push to `main`. Pages is already enabled for the repository.
3. Check <https://jbharadwaja.github.io/my-portfolio/> serves the new site.

Notes:

- Asset paths are relative so the `/my-portfolio/` sub-path works. `404.html` is the one file with absolute
  paths (`/my-portfolio/...`), because GitHub Pages serves it at any missing URL, however deep.
- `.nojekyll` keeps Pages from running Jekyll over the files.
- The CV links ship in their LinkedIn fallback state, and `assets/cv/` does not exist. Publishing the PDF
  (`assets/cv/Julian_Bharadwaja_Resume.pdf`) is Julian's call, because the resume contains his phone number.
