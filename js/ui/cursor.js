// Custom cursor (spec §6.3): an 8 px dot on the pointer and a 28 px ring that lags it. Over links and buttons the
// ring grows to 48 px and the element leans toward the pointer (at most 6 px); over the rail the ring reads `drag`;
// over the Route map while the reticle is on (route.js sets .reticle-on on the stage and prints the readout beside the
// pointer), a crosshair. Mouse only: on from the first mouse move, off at any touch or pen press; hidden while the
// console is open (html.console-shown, css/sections/ui.css). The rail's drag itself is experiments.js's: it shares
// DRAG_THRESHOLD (Ruling R4). The maths is pure and Node-testable; createCursor touches the DOM only when called.
import { CURSOR_DRAG } from '../content.js';

/** A press becomes a drag after this many CSS px of movement. */
export const DRAG_THRESHOLD = 6;

/** Whether a press that has moved `dist` CSS px is a drag. */
export function isDrag(dist) {
  return dist > DRAG_THRESHOLD;
}

const RING_LERP = 0.18;                // the ring's share of the way to the pointer per 60 fps frame
const MAGNET_MAX = 6;                  // px an element leans toward the pointer, at most
const SETTLED = 0.05;                  // px: closer than this to where it is going, a ring or an element stops easing

/** The ring's lerp factor for a frame of `dt` seconds: 0.18 per 60 fps frame, whatever the frame rate. */
export function ringFactor(dt) {
  return 1 - (1 - RING_LERP) ** (dt * 60);
}

/**
 * How far an element `w` × `h` leans toward a pointer (dx, dy) from its centre: in proportion to the pointer's place
 * across it (at its edge, the full pull), the length capped at 6 px.
 */
export function magnetPull(dx, dy, w, h) {
  const x = (dx / Math.max(w / 2, 1)) * MAGNET_MAX;
  const y = (dy / Math.max(h / 2, 1)) * MAGNET_MAX;
  const scale = Math.min(1, MAGNET_MAX / (Math.hypot(x, y) || 1));
  return [x * scale, y * scale];
}

const MAGNETIC = 'a[href], button:not(:disabled)';
const RAIL = '#work.rail-on .rail-viewport';

/**
 * Adds the cursor to `root` (the page's body) and follows the mouse. Returns { destroy } (removes it and every listener).
 */
export function createCursor({ root }) {
  const doc = root.ownerDocument;
  const html = doc.documentElement;
  const el = doc.createElement('div');
  el.className = 'cursor';
  el.setAttribute('aria-hidden', 'true');
  const dot = doc.createElement('div');
  dot.className = 'cursor-dot';
  const ring = doc.createElement('div');
  ring.className = 'cursor-ring';
  const label = doc.createElement('span');
  label.className = 'cursor-label mono';
  label.textContent = CURSOR_DRAG;
  ring.append(label);
  el.append(dot, ring);                // the ring over the dot: its filled `drag` state covers it
  root.append(el);

  const pointer = { x: 0, y: 0 };
  const ringAt = { x: 0, y: 0 };
  const magnets = new Map();           // element → { x, y, tx, ty }: its lean now and where it is easing to
  let magnet = null;                   // the link or button under the pointer
  let target = null;                   // the element under the pointer
  let on = false;
  let hitTest = false;                 // the page scrolled under a resting pointer: find what is under it again
  let frame = 0;
  let last = 0;
  const off = new AbortController();
  const listen = (node, type, fn, opts = {}) => node.addEventListener(type, fn, { ...opts, signal: off.signal });

  const place = (node, { x, y }) => { node.style.transform = `translate3d(${x}px, ${y}px, 0)`; };

  function setMagnet(next) {
    if (next === magnet) return;
    const prev = magnets.get(magnet);
    if (prev) prev.tx = prev.ty = 0;   // eases back to rest, then lets go of its style
    magnet = next;
    if (next && !magnets.has(next)) magnets.set(next, { x: 0, y: 0, tx: 0, ty: 0 });
  }

  // Where the hovered element leans: measured from its resting centre (its box less the lean it already has).
  function aimMagnet() {
    const m = magnets.get(magnet);
    if (!m) return;
    const box = magnet.getBoundingClientRect();
    const dx = pointer.x - (box.left + box.width / 2 - m.x);
    const dy = pointer.y - (box.top + box.height / 2 - m.y);
    [m.tx, m.ty] = magnetPull(dx, dy, box.width, box.height);
  }

  // The ring's state from what is under the pointer. The crosshair needs the readout route.js prints on its frames,
  // so this runs every frame while the pointer is over a stage with a readout.
  function classify() {
    if (html.classList.contains('console-shown')) target = null;   // hidden: nothing under it leans or lights
    const link = target?.closest?.(MAGNETIC) ?? null;
    const stage = target?.closest?.('.stage.reticle-on');
    const cross = Boolean(stage?.querySelector('.reticle-readout')?.textContent);
    setMagnet(cross ? null : link);
    el.classList.toggle('is-cross', cross);
    el.classList.toggle('is-link', !cross && Boolean(link));
    el.classList.toggle('is-drag', !cross && !link && Boolean(target?.closest?.(RAIL)));
  }

  const watching = () => Boolean(target?.closest?.('.stage')?.querySelector('.reticle-readout'));

  function tick(now) {
    frame = 0;
    const k = ringFactor(last ? (now - last) / 1000 : 1 / 60);
    last = now;
    if (hitTest) {
      hitTest = false;
      if (!el.classList.contains('is-out')) target = doc.elementFromPoint(pointer.x, pointer.y);
      classify();
      if (magnet) aimMagnet();
    } else {
      classify();
    }
    ringAt.x += (pointer.x - ringAt.x) * k;
    ringAt.y += (pointer.y - ringAt.y) * k;
    place(ring, ringAt);
    let busy = Math.abs(pointer.x - ringAt.x) > SETTLED || Math.abs(pointer.y - ringAt.y) > SETTLED;
    for (const [node, m] of magnets) {
      m.x += (m.tx - m.x) * k;
      m.y += (m.ty - m.y) * k;
      const settled = Math.abs(m.tx - m.x) <= SETTLED && Math.abs(m.ty - m.y) <= SETTLED;
      if (settled && node !== magnet && m.tx === 0 && m.ty === 0) {
        node.style.removeProperty('translate');
        magnets.delete(node);
        continue;
      }
      node.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`;
      busy ||= !settled;
    }
    if (busy || watching()) frame = requestAnimationFrame(tick);
    else last = 0;
  }

  const wake = () => {
    if (on && !frame) frame = requestAnimationFrame(tick);
  };

  function enable(e) {
    on = true;
    ringAt.x = e.clientX;
    ringAt.y = e.clientY;
    place(ring, ringAt);
    html.classList.add('cursor-on');
  }

  function disable() {
    if (!on) return;
    on = false;
    html.classList.remove('cursor-on');
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    magnet = null;
    for (const node of magnets.keys()) node.style.removeProperty('translate');
    magnets.clear();
  }

  listen(window, 'pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (!on) enable(e);
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    place(dot, pointer);               // no lag: the dot moves with the event, not on the next frame
    el.classList.remove('is-out');
    target = e.target;
    classify();
    if (magnet) aimMagnet();
    wake();
  }, { passive: true });
  listen(window, 'pointerdown', (e) => {
    if (e.pointerType !== 'mouse') disable();
  }, { passive: true, capture: true });
  listen(window, 'pointerout', (e) => {
    if (e.relatedTarget || !on) return;
    el.classList.add('is-out');        // left the window: hidden, and whatever leaned toward it lets go
    target = null;
    classify();
    wake();
  }, { passive: true });
  listen(window, 'scroll', () => {
    hitTest = true;
    wake();
  }, { passive: true });

  return {
    destroy() {
      disable();
      off.abort();
      el.remove();
    },
  };
}
