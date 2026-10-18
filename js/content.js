// Off-page strings: what scripts print that the static page does not carry (the page's own copy lives only in
// index.html). The ~ console's text, the cursor's rail label and the CV link in both of its
// states (index.html ships the publish state: the same links cvLinkAttrs(true, slot) writes). Pure,
// Node-testable: applyCvState only touches the document it is given.

/** Whether the CV PDF is published: true makes every CV link a download, false is the LinkedIn fallback. */
export const CV_PUBLISHED = true;

const CV_FILE = 'Julian_Bharadwaja_Resume.pdf';
const CV = {
  fallback: { href: 'https://www.linkedin.com/in/julian-bharadwaja/', target: '_blank', rel: 'noopener', download: null },
  publish: { href: `assets/cv/${CV_FILE}`, target: null, rel: null, download: CV_FILE },
};
/** The link text per state: the header's bracketed label, and the hero's and sign-off's inline one. */
const CV_TEXT = {
  fallback: { header: '[ CV ↗ ]', inline: 'CV on LinkedIn ↗' },
  publish: { header: '[ CV ↓ ]', inline: 'Download CV' },
};

/**
 * The CV link for `slot` ('header' | 'hero' | 'signoff'), published or in the LinkedIn fallback:
 * { href, target, rel, download, text }, null for an attribute the link must not carry.
 */
export function cvLinkAttrs(published, slot) {
  const state = published ? 'publish' : 'fallback';
  return { ...CV[state], text: CV_TEXT[state][slot === 'header' ? 'header' : 'inline'] };
}

/** Writes the CV state into every a[data-cv] in `doc` (its data-cv names the slot); index.html ships the publish state. */
export function applyCvState(doc, published) {
  for (const link of doc.querySelectorAll('a[data-cv]')) {
    const attrs = cvLinkAttrs(published, link.getAttribute('data-cv'));
    for (const name of ['href', 'target', 'rel', 'download']) {
      if (attrs[name] === null) link.removeAttribute(name);
      else if (link.getAttribute(name) !== attrs[name]) link.setAttribute(name, attrs[name]);
    }
    if (link.textContent !== attrs.text) link.textContent = attrs.text;
  }
}

export const WHOAMI = 'julian bharadwaja — data scientist · ml engineer · data analyst — tustin, ca';

/** Every console command with its one-line description, in the order `help` lists them. */
export const HELP = {
  help: 'list commands',
  whoami: 'who this is',
  projects: 'the eight experiments, in rail order',
  'open <n>': 'jump to experiment n on the rail',
  skills: 'the three skill groups',
  journey: 'the four stops of the route',
  contact: 'email, LinkedIn and GitHub',
  resume: 'get the CV',
  train: 'run a tiny training job',
  clear: 'clear the console',
  exit: 'close the console',
  'sudo hire-me': 'you know you want to',
};

/** The console's own lines; the functions fill in what was typed. */
export const CONSOLE = {
  prompt: '~',
  welcome: 'type help for commands · tab completes · exit or esc closes',
  sudo: '[sudo] permission granted — opening mail…',
  notFound: (input, guess) => `command not found: ${input} — did you mean ${guess}?`,
  notFoundHelp: (input) => `command not found: ${input} — type help`,
  noExperiment: (n, count) => `open: no experiment ${n} (1–${count})`,
  openUsage: (count) => `usage: open <n> (1–${count})`,
  resumeDownload: (file) => `resume: downloading ${file}`,
  resumeOpen: (url) => `resume: opening ${url} in a new tab`,
  resumeMissing: 'resume: no CV link on this page',
};

/** The ring's label over the rail. */
export const CURSOR_DRAG = 'drag';
