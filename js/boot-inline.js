/* Latent Space boot (spec 6.1). Reference copy: index.html carries these exact bytes inline, first in <head>. */
(function (w, d) {
  var h = d.documentElement, failures = 0, first = '', failed = {};
  h.classList.remove('no-js');
  h.classList.add('js', 'preload');

  var V = w.__veil = {
    lifted: false,
    lift: function () {
      if (V.lifted) return;
      V.lifted = true;
      h.classList.add('veil-done');
      paint();
      d.dispatchEvent(new Event('veil:lift'));
    },
    banner: function (url) {
      failures++;
      first = first || String(url);
      paint();
    }
  };

  /* what the DOM can show so far: the veil's label and the asset banner */
  function paint() {
    var veil = d.querySelector('.veil'), banner = d.querySelector('.banner');
    if (veil && V.lifted) veil.setAttribute('aria-label', 'Loaded');
    if (banner && failures) {
      banner.textContent = 'Could not load ' + first + (failures > 1 ? ' (+' + (failures - 1) + ' more)' : '');
      banner.hidden = false;
    }
  }

  /* the 8 s cap. A stylesheet still pending by now (a stalled CDN) would keep the page unpainted, so it is
     switched to media=print, which stops it blocking first paint and scripts, and applies if it ever arrives */
  function cap() {
    var links = d.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (l.sheet || failed[l.href]) continue;
      V.banner(l.href);
      l.media = 'print';
      l.addEventListener('load', function () { this.removeAttribute('media'); });
    }
    V.lift();
  }

  setTimeout(cap, 8000);
  w.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
      var url = t.src || t.href;
      failed[url] = 1;
      V.banner(url);
      V.lift();
    }
  }, true);
  d.addEventListener('DOMContentLoaded', paint);
  w.addEventListener('load', function () {
    requestAnimationFrame(function () { h.classList.remove('preload'); });
  });
})(window, document);
