// TEMPORARY (Task 4): proves the boot path only. A later task replaces this with the real orchestrator.
// Debug flags: ?simulate=hang (never signals ready; the 8 s cap lifts the veil),
//              ?simulate=cdnfail (a CDN import fails: banner naming the URL, the veil still lifts).
import { veil } from './ui/veil.js';

const simulate = new URLSearchParams(location.search).get('simulate');

if (simulate === 'cdnfail') {
  const url = 'https://cdn.jsdelivr.net/npm/three@0.0.0-nope/x.js';
  try {
    await import(url);
  } catch {
    window.__veil.banner(url);
  }
}

await document.fonts.ready;
if (simulate === 'hang') await new Promise(() => {});
await veil.liftWhenReady();
