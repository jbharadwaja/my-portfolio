// The sections main.js loads after the scroll setup, in page order; each js/sections/<name>.js exports init(ctx).
// The hero is not here: it inits at boot because it gates the veil (see main.js). Pure, so Node tests can import it.
export const SECTIONS = ['encoder', 'training', 'experiments', 'route', 'about', 'signoff'];
