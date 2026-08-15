import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import { createEditorRuntimeLoader } from '../src/platform/browser.js';

const fixture = (name) => path.join(import.meta.dirname, 'fixtures', name);
const manifest = { assets: [{ path: 'wasm/editor.wasm', mediaType: 'application/wasm' }] };

test('Editor browser entry initializes under a strict CSP guard', async () => {
  const child = spawn(process.execPath, [fixture('csp.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal(stdout, 'browser:ready');
});

test('Editor loader supports offline cache fetch and stable cache-miss errors', async () => {
  const url = 'https://offline.test/pkg/generated/wasm/editor.wasm';
  const cache = new Map([[url, new Uint8Array([0, 97, 115, 109])]]);
  const loader = createEditorRuntimeLoader({
    manifest,
    moduleUrl: 'https://offline.test/pkg/src/runtime/assets.js',
    fetch: async (assetUrl) => cache.has(assetUrl.href)
      ? new Response(cache.get(assetUrl.href), { status: 200 })
      : new Response(null, { status: 504 }),
  });
  assert.equal((await loader.loadAssets()).size, 1);
  cache.clear();
  await assert.rejects(loader.loadAssets(), (error) => error.code === 'RESOURCE_NOT_FOUND');
});

test('Editor explicit worker entry initializes in worker_threads', async () => {
  const worker = new Worker(fixture('worker.mjs'));
  const [message] = await once(worker, 'message');
  assert.deepEqual(message, { platform: 'worker', state: 'ready' });
  await worker.terminate();
});
