// Off-page strings: what scripts print that the static page does not carry (the page's own copy lives only in
// index.html). The ~ console's text (spec §6.4), the cursor's rail label (spec §6.3) and the CV publish state
// (spec §6.2). Pure data, Node-testable.

/** Whether the CV PDF is published (spec §6.2): false keeps the LinkedIn fallback. */
export const CV_PUBLISHED = false;

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

/** The ring's label over the rail (spec §6.3). */
export const CURSOR_DRAG = 'drag';
