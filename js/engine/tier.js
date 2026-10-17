// Device tier, DPR budget and the resize filter (spec §4.1, §4.8). Pure and Node-testable: the browser is read
// only through the window handed to readEnv().

const TIERS = {
  saver:   { name: 'saver',   N: 10000, dust: 400,  dprCap: 1,    renderCap: 30, repulsion: false },
  mobile:  { name: 'mobile',  N: 14000, dust: 800,  dprCap: 1,    renderCap: 60, repulsion: false },
  desktop: { name: 'desktop', N: 48000, dust: 3000, dprCap: 1.5,  renderCap: 0,  repulsion: true },
  laptop:  { name: 'laptop',  N: 28000, dust: 1500, dprCap: 1.25, renderCap: 60, repulsion: true },
};

const PIXEL_BUDGET = 3.2e6;        // drawing-buffer pixels a window may cost (a 4K window renders ~3.2 MP)
const MOBILE_RESIZE_SLACK = 0.25;  // coarse pointers: same width and |Δh| under 25% is the URL bar, not a resize

/** What the tier depends on, read once at load. deviceMemory is null where the browser does not expose it. */
export function readEnv(win) {
  const nav = win.navigator ?? {};
  return {
    saveData: Boolean(nav.connection?.saveData),
    deviceMemory: nav.deviceMemory ?? null,
    innerWidth: win.innerWidth,
    coarse: win.matchMedia('(pointer: coarse)').matches,
    fine: win.matchMedia('(pointer: fine)').matches,
  };
}

/** The tier table of spec §4.1, top to bottom, first match wins. Laptop/tablet repulsion needs a fine pointer. */
export function pickTier({ saveData, deviceMemory, innerWidth, coarse, fine }) {
  if (saveData || (Number.isFinite(deviceMemory) && deviceMemory <= 2)) return { ...TIERS.saver };
  if (innerWidth < 768 || (coarse && innerWidth < 1024)) return { ...TIERS.mobile };
  if (fine && innerWidth >= 1280) return { ...TIERS.desktop };
  return { ...TIERS.laptop, repulsion: Boolean(fine) };
}

/** Render DPR: the cap, lowered so the buffer stays near the pixel budget, never below 1. */
export function computeDpr(cap, cssW, cssH) {
  return Math.max(1, Math.min(cap, Math.sqrt(PIXEL_BUDGET / (cssW * cssH))));
}

/** Coarse-pointer resizes that keep the width and change the height by less than 25% (mobile URL bar). */
export function shouldIgnoreResize(prev, next, coarse) {
  return coarse && next.w === prev.w && Math.abs(next.h - prev.h) < MOBILE_RESIZE_SLACK * prev.h;
}
