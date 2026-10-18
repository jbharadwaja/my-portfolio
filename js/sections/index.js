// The sections main.js loads after the scroll setup, in page order; each js/sections/<name>.js exports init(ctx).
// The hero is not here: it inits at boot because it gates the veil (see main.js). Pure, so Node tests can import it.
export const SECTIONS = ['encoder', 'training', 'experiments', 'route', 'about', 'signoff'];

/**
 * Loads and initialises sections. Every `importer(name)` starts at once, so the module fetches overlap;
 * the inits then run one after another in the order given, each awaited before the next. A section whose import or
 * init fails is passed to `log` by name and the rest carry on. Resolves once the last init has settled; never rejects.
 * @param {string[]} names
 * @param {(name: string) => Promise<{ init: (ctx: object) => unknown }>} importer
 * @param {object} ctx
 * @param {(message: string, err: unknown) => void} log
 */
export async function loadSections(names, importer, ctx, log) {
  const modules = names.map((name) => {
    const mod = new Promise((resolve) => resolve(importer(name)));   // a synchronous throw becomes a rejection
    mod.catch(() => {});   // reported in page order below, not as an unhandled rejection while an earlier init runs
    return mod;
  });
  for (const [i, name] of names.entries()) {
    try {
      await (await modules[i]).init(ctx);
    } catch (err) {
      log(`Section "${name}" failed to initialise.`, err);
    }
  }
}
