// Fixed chrome behaviour (spec §2.1): in-page links jump through ctx.scroll, the burger sheet below 1024 px,
// and the section HUD. The HUD's hiding while the veil is up and below 768 px is CSS (css/main.css).

const WIDE = '(min-width: 1024px)';

export function initNav({ scroll, ScrollTrigger }) {
  const closeSheet = initSheet(scroll);
  initLinks(scroll, closeSheet);
  initHud(scroll, ScrollTrigger);
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
function initHud(scroll, ScrollTrigger) {
  const label = document.querySelector('.hud-label');
  const bar = document.querySelector('.hud-bar');
  if (!label || !bar) return;
  const names = [...document.querySelectorAll('main > section')].map((s) => s.dataset.hud);
  let shown = -1;

  function update() {
    const i = scroll.sectionIndex();
    if (i !== shown && names[i]) {
      shown = i;
      label.textContent = names[i];
    }
    const max = document.scrollingElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0})`;
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  ScrollTrigger?.addEventListener('refresh', update);
  update();
}
