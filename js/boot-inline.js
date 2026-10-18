/* Latent Space boot. Reference copy: index.html carries these exact bytes inline, first in <head>. */
(function (w, d) {
  var h = d.documentElement, named = [], failed = {}, closed = false, waiting = false;
  h.classList.remove('no-js');
  h.classList.add('js', 'preload');

  var V = w.__veil = {
    lifted: false,
    /* a tab opened in the background runs no frames: the lift (and the veil's CSS backstop) waits for the visitor,
       until their second frame, when gsap's ticker has caught up with the time spent hidden, so the entrance plays
       from its start in front of them. The page's transitions come on a frame after the lift, even if window load
       never fires */
    lift: function () {
      if (V.lifted) return;
      if (d.hidden) {
        if (!waiting) {
          waiting = true;
          h.classList.add('veil-wait');
          d.addEventListener('visibilitychange', function shown() {
            if (d.hidden) return;
            d.removeEventListener('visibilitychange', shown);
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                waiting = false;
                h.classList.remove('veil-wait');
                V.lift();
              });
            });
          });
        }
        return;
      }
      V.lifted = true;
      h.classList.add('veil-done');
      requestAnimationFrame(function () { h.classList.remove('preload'); });
      paint();
      d.dispatchEvent(new Event('veil:lift'));
    },
    /* an asset that failed: the banner names it once */
    banner: function (url) { name(url, false); },
    /* one still in flight when the veil lifts: named as still loading, never as failed */
    slow: function (url) { name(url, true); },
    /* whether a script, preload or stylesheet at this URL failed to load (veil.js stops waiting for a font sheet) */
    failed: function (url) { return failed[String(url)] === 1; },
    /* a URL named earlier arrived after all (an import past the cap): it leaves the banner, hidden once empty */
    clear: function (url) {
      for (var i = 0; i < named.length; i++) {
        if (named[i].url === String(url)) {
          named.splice(i, 1);
          paint();
          return;
        }
      }
    }
  };

  /* a new name (or a slow one that failed) shows the banner again, even after it was dismissed */
  function name(url, slow) {
    url = String(url);
    for (var i = 0; i < named.length; i++) {
      if (named[i].url !== url) continue;
      if (slow || !named[i].slow) return;
      named[i].slow = false;
      closed = false;
      paint();
      return;
    }
    named.push({ url: url, slow: slow });
    closed = false;
    paint();
  }

  /* host and the path's last two parts: cdn.jsdelivr.net/…/build/three.module.js */
  function label(url) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)([^?#]*)/i.exec(url), parts = [], all, i;
    if (!m) return url;
    all = m[2].split('/');
    for (i = 0; i < all.length; i++) if (all[i]) parts.push(all[i]);
    return m[1] + (parts.length ? '/' + (parts.length > 2 ? '…/' : '') + parts.slice(-2).join('/') : '');
  }

  /* what the DOM can show so far: the veil's label and the asset banner (failures first, then what is still
     loading; the full URL in its title) */
  function paint() {
    var veil = d.querySelector('.veil'), banner = d.querySelector('.banner'), out, lost = [], late = [], list, n, i, text;
    if (veil && V.lifted) veil.setAttribute('aria-label', 'Loaded');
    if (!banner) return;
    for (i = 0; i < named.length; i++) (named[i].slow ? late : lost).push(named[i].url);
    list = lost.length ? lost : late;
    n = list.length;
    text = !n ? '' : (lost.length ? 'Could not load ' : 'Still loading ') + label(list[0]) +
      (n > 1 ? ' (+' + (n - 1) + ' more)' : '') + (lost.length ? '' : ' — the page works without it');
    out = (banner.querySelector && banner.querySelector('.banner-text')) || banner;
    if (out.textContent !== text) out.textContent = text;
    out.title = n ? list[0] : '';
    banner.hidden = !n || closed;
  }

  /* the 8 s cap. A stylesheet still pending by now (a stalled CDN) would keep the page unpainted, so it is
     switched to media=print, which stops it blocking first paint and scripts; if it ever arrives it applies and
     leaves the banner (it was slow, not failed) */
  function cap() {
    var links = d.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (l.sheet || failed[l.href]) continue;
      V.slow(l.href);
      l.media = 'print';
      l.addEventListener('load', function () { this.removeAttribute('media'); V.clear(this.href); });
    }
    V.lift();
  }

  setTimeout(cap, 8000);
  /* a failed script or preload lifts the veil at once; a failed stylesheet (fonts blocked) is only named, and the
     meter carries on without it. main.js failing (its module graph) leaves nothing to run the page: it shows as
     the no-JS page, whose header and links need no script */
  w.addEventListener('error', function (e) {
    var t = e && e.target, url;
    if (!t || (t.tagName !== 'SCRIPT' && t.tagName !== 'LINK')) return;
    url = t.src || t.href;
    failed[url] = 1;
    V.banner(url);
    if (t.tagName === 'SCRIPT' && /\/js\/main\.js$/.test(url)) {
      h.classList.remove('js', 'preload');
      h.classList.add('no-js', 'js-failed');
    }
    if (t.tagName === 'SCRIPT' || !/(^|\s)stylesheet(\s|$)/i.test(t.rel || '')) V.lift();
  }, true);
  d.addEventListener('click', function (e) {
    var t = e && e.target;
    if (!t || !t.closest || !t.closest('.banner-close')) return;
    closed = true;
    paint();
  });
  d.addEventListener('DOMContentLoaded', paint);
  w.addEventListener('load', function () {
    requestAnimationFrame(function () { h.classList.remove('preload'); });
  });
})(window, document);
