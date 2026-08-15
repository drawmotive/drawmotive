import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeEditor, validateEditorAdapters } from '../src/index.js';

const allAdapters = () => ({
  files: { open: async () => new Uint8Array(), save: async () => undefined },
  storage: { get: async () => undefined, set: async () => undefined, delete: async () => undefined },
  theme: { getCurrent: () => 'dark', subscribe: () => () => undefined },
  commands: { execute: async () => undefined, subscribe: () => () => undefined },
  network: { fetch: async () => new Response() },
});

test('Editor validates adapter methods and subscription cleanup contracts', () => {
  assert.throws(() => validateEditorAdapters({ storage: { get() {}, set() {} } }), (error) => error.code === 'INVALID_ADAPTER');
  const invalidSubscription = validateEditorAdapters({ theme: { getCurrent: () => 'dark', subscribe: () => undefined } });
  assert.throws(
    () => invalidSubscription.theme.subscribe(() => undefined),
    (error) => error.code === 'INVALID_ADAPTER' && error.details.method === 'subscribe',
  );
  const snapshot = validateEditorAdapters(allAdapters());
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.storage));
  let cleanups = 0;
  const subscriptions = validateEditorAdapters({
    theme: { getCurrent: () => 'dark', subscribe: () => () => { cleanups += 1; } },
  });
  const unsubscribe = subscriptions.theme.subscribe(() => undefined);
  unsubscribe();
  unsubscribe();
  assert.equal(cleanups, 1);
});

test('Editor forwards TextGraph adapters and passes the full snapshot to its runtime', async () => {
  const adapters = allAdapters();
  const controller = new AbortController();
  let textGraphOptions;
  let editorOptions;
  await initializeEditor({
    signal: controller.signal,
    adapters,
    initializeTextGraph: async (options) => { textGraphOptions = options; return { dispose: async () => undefined }; },
    loadRuntime: async (options) => { editorOptions = options; return { abiVersion: '1.0.0' }; },
  });
  assert.deepEqual(Object.keys(textGraphOptions.adapters).sort(), ['files', 'network']);
  assert.equal(textGraphOptions.signal, controller.signal);
  assert.deepEqual(Object.keys(editorOptions.adapters).sort(), ['commands', 'files', 'network', 'storage', 'theme']);
});
