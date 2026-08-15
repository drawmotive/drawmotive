import assert from 'node:assert/strict';
import test from 'node:test';

import { DrawMotiveError, initializeEditor } from '../src/index.js';

const textgraph = () => ({ abiVersion: '1.0.0', dispose: async () => undefined });
const options = (runtime) => ({ initializeTextGraph: async () => textgraph(), loadRuntime: async () => runtime });

test('Editor validates its own ABI and releases TextGraph after initialization failure', async () => {
  let disposed = 0;
  await assert.rejects(
    initializeEditor({
      initializeTextGraph: async () => ({ dispose: async () => { disposed += 1; } }),
      loadRuntime: async () => ({ abiVersion: '2.0.0' }),
    }),
    (error) => error instanceof DrawMotiveError && error.code === 'ABI_MISMATCH',
  );
  assert.equal(disposed, 1);
});

test('Editor forwards cancellation and exposes the managed lifecycle contract', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(initializeEditor({ signal: controller.signal, initializeTextGraph: async () => { called = true; }, loadRuntime: async () => ({}) }), { name: 'AbortError' });
  assert.equal(called, false);

  let editorDisposals = 0;
  let textgraphDisposals = 0;
  const instance = await initializeEditor({
    initializeTextGraph: async () => ({ dispose: async () => { textgraphDisposals += 1; } }),
    loadRuntime: async () => ({ abiVersion: '1.0.0', dispose: async () => { editorDisposals += 1; } }),
  });
  assert.equal(instance.state, 'ready');
  assert.equal(await instance.readonly(() => 42), 42);
  await Promise.all([instance.dispose(), instance.dispose()]);
  assert.equal(editorDisposals, 1);
  assert.equal(textgraphDisposals, 1);
  await assert.rejects(instance.mutate(() => 1), (error) => error.code === 'INSTANCE_DISPOSED');
});
