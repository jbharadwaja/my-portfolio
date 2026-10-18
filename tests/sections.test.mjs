import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSections } from '../js/sections/index.js';

// The section loader: every import starts at once, the inits then run one after another in page order,
// and a section that fails to load or to initialise is logged by name without stopping the rest.
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake importer: modules resolve after `delays[name]` ms; `events` records imports, init starts and init ends. */
function fakeImporter(delays, { events, fail = {} } = {}) {
  return (name) => {
    events.push(`import ${name}`);
    if (fail[name] === 'throw') throw new Error(`${name}: import threw`);
    return tick(delays[name] ?? 0).then(() => {
      if (fail[name] === 'reject') throw new Error(`${name}: import failed`);
      return {
        async init(ctx) {
          events.push(`init ${name}`);
          if (fail[name] === 'init') throw new Error(`${name}: init failed`);
          await tick(1);
          ctx.inited.push(name);
          events.push(`done ${name}`);
        },
      };
    });
  };
}

test('starts every import before the first init, then inits in page order whatever order imports land in', async () => {
  const events = [];
  const ctx = { inited: [] };
  // The last section's module arrives first, the first section's last.
  const importer = fakeImporter({ a: 30, b: 20, c: 10, d: 0 }, { events });
  await loadSections(['a', 'b', 'c', 'd'], importer, ctx, () => assert.fail('nothing fails'));
  assert.deepEqual(events.slice(0, 4), ['import a', 'import b', 'import c', 'import d']);
  assert.deepEqual(events.slice(4), ['init a', 'done a', 'init b', 'done b', 'init c', 'done c', 'init d', 'done d'],
    'each init finishes before the next one starts');
  assert.deepEqual(ctx.inited, ['a', 'b', 'c', 'd']);
});

test('a section failing to import or to initialise is logged by name; the rest still initialise in order', async () => {
  const events = [];
  const logged = [];
  const ctx = { inited: [] };
  const fail = { b: 'throw', c: 'reject', e: 'init' };
  const importer = fakeImporter({ a: 5, b: 0, c: 0, d: 0, e: 0, f: 0 }, { events, fail });
  const log = (message, err) => logged.push([message, err.message]);
  await loadSections(['a', 'b', 'c', 'd', 'e', 'f'], importer, ctx, log);
  assert.deepEqual(ctx.inited, ['a', 'd', 'f']);
  assert.deepEqual(logged, [
    ['Section "b" failed to initialise.', 'b: import threw'],
    ['Section "c" failed to initialise.', 'c: import failed'],
    ['Section "e" failed to initialise.', 'e: init failed'],
  ]);
});

test('a later import failing while an earlier section is still initialising is no unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const ctx = { inited: [] };
    const logged = [];
    const slowFirst = (name) => (name === 'a'
      ? Promise.resolve({ init: () => tick(40).then(() => ctx.inited.push('a')) })
      : Promise.reject(new Error(`${name}: import failed`)));
    await loadSections(['a', 'b'], slowFirst, ctx, (message) => logged.push(message));
    await tick(10);   // give the runtime a turn to report anything left unhandled
    assert.deepEqual(unhandled, []);
    assert.deepEqual(ctx.inited, ['a']);
    assert.deepEqual(logged, ['Section "b" failed to initialise.']);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('every init receives the shared ctx, and the loader resolves once the last init has finished', async () => {
  const seen = [];
  const ctx = { id: 'shared' };
  const importer = (name) => Promise.resolve({ init: async (c) => { await tick(1); seen.push([name, c]); } });
  await loadSections(['x', 'y'], importer, ctx, () => {});
  assert.deepEqual(seen, [['x', ctx], ['y', ctx]]);
});
