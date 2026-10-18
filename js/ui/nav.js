// Fixed chrome behaviour (spec §2.1): in-page links jump through ctx.scroll, the burger sheet below 1024 px,
// the section HUD (resting while the hero is current), and the header's ground once the page leaves the top.
// The HUD's hiding while the veil is up, below 768 px wide and under 560 px tall is CSS (css/main.css).
// main.js calls this before the CDN libraries settle. ctx.scroll is one object for the page's lifetime (native
// scroll at first, upgraded in place by scroll.attach), so nothing here needs gsap, ScrollTrigger or Lenis.

const WIDE = '(min-width: 1024px)';
const SCROLLED_PX = 8;                 // the header takes its ground once the page is this far from the top

/**
 * Whether the section HUD rests (is transparent) while section `index` is current: only in the hero (Ruling R50:
 * the fixed chrome never covers readable copy). The HUD sits bottom left, where the hero copy runs — the role line
 * and lead at first view on a short landscape phone, the first panel on a tablet — and the hero carries its own
 * HUD (the denoise step, top right), as it carries no section index without JS either. It shows from the encoder on.
 */
export function hudResting(index) {
  return index === 0;
}

export function initNav({ scroll }) {
  const closeSheet = initSheet(scroll);
  initLinks(scroll, closeSheet);
  initHud(scroll);
  initHeaderGround();
}

// Past the top the header gets its paper (or night) ground, so its items never sit on copy or particles
// (Ruling R50; the ground itself is CSS, .site-header.is-scrolled).
function initHeaderGround() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > SCROLLED_PX);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// Every in-page link (header, wordmark, hero CTA, sheet, skip link) jumps instead of following the hash.
// Focus moves to the target, as the native anchor jump would have moved the keyboard's starting point.
function initLinks(scroll, closeSheet) {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest?.('a[href^="#"]');
    const id = link ? decodeURIComponent(link.hash.slice(1)) : '';
    const target = id && document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    closeSheet({ returnFocus: false });
    scroll.jumpTo(id);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}

/** Returns close({ returnFocus }) — a no-op while the sheet is shut. */
function initSheet(scroll) {
  const sheet = document.getElementById('sheet');
  const burger = document.querySelector('.burger');
  const closeButton = sheet?.querySelector('.sheet-close');
  if (!sheet || !burger || !closeButton) return () => {};
  const isOpen = () => !sheet.hidden;

  function open() {
    if (isOpen()) return;
    sheet.hidden = false;
    burger.setAttribute('aria-expanded', 'true');
    scroll.lock();
    closeButton.focus();
  }

  function close({ returnFocus = true } = {}) {
    if (!isOpen()) return;
    sheet.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
    scroll.unlock();
    if (returnFocus) burger.focus();
  }

  // Tab and Shift+Tab cycle inside the sheet; focus that has strayed outside it (a click on the backdrop) comes back.
  function trapTab(e) {
    const items = sheet.querySelectorAll('a[href], button');
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = sheet.contains(active);
    if (e.shiftKey ? active === first || !inside : active === last || !inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }

  burger.addEventListener('click', open);
  closeButton.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      trapTab(e);
    }
  });
  // Widening past 1024 px hides the burger: never leave the sheet (and the scroll lock) behind it.
  matchMedia(WIDE).addEventListener('change', (e) => {
    if (e.matches) close({ returnFocus: false });
  });
  return close;
}

// The label of the current section (its top has crossed the viewport centre) and the whole-page progress bar.
function initHud(scroll) {
  const hud = document.querySelector('.hud');
  const label = hud?.querySelector('.hud-label');
  const bar = hud?.querySelector('.hud-bar');
  if (!label || !bar) return;
  const names = [...document.querySelectorAll('main > section')].map((s) => s.dataset.hud);
  let shown = -1;

  function update() {
    const i = scroll.sectionIndex();
    if (i !== shown && names[i]) {
      shown = i;
      label.textContent = names[i];
      hud.classList.toggle('is-resting', hudResting(i));
    }
    const max = document.scrollingElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0})`;
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // Section lengths also change with no scroll or resize event: .js-scroll arriving with the libraries, ScrollTrigger refreshes.
  new ResizeObserver(update).observe(document.body);
  update();
}
