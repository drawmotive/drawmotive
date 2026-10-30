import test from 'node:test';
import assert from 'node:assert/strict';
const factoryModule = await import('../src/platform/worker-factory.js').catch(() => ({}));
import { createResourceWorkerClient } from '../src/resources/resource-worker-client.js';
import { createDocumentWorkerClient } from '../src/storage/worker-client.js';

for (const create of [createResourceWorkerClient, createDocumentWorkerClient]) {
  test(create.name + ': invalid construction never creates a Worker', async () => {
    let created = 0;
    const workerFactory = async () => { created++; return { worker: {}, dispose() {} }; };
    await assert.rejects(create({ timeoutMs: 0, workerFactory }), TypeError);
    await assert.rejects(create({ timeoutMs: NaN, workerFactory }), TypeError);
    assert.equal(created, 0);
  });

  test(create.name + ': a failed channel construction releases the Worker', async () => {
    let released = 0;
    const workerFactory = async () => ({ worker: { addEventListener() { throw new Error('Cannot subscribe'); } }, dispose() { released++; } });
    await assert.rejects(create({ workerFactory }), /Cannot subscribe/);
    assert.equal(released, 1);
  });
}

test('static workers use the package URL and terminate exactly once', async () => {
  assert.equal(typeof factoryModule.createWorkerFactory, 'function');
  const calls = [];
  class Worker { constructor(url, options) { calls.push([String(url), options]); } terminate() { calls.push('terminate'); } }
  const factory = factoryModule.createWorkerFactory({ Worker });
  const handle = await factory(new URL('https://assets.test/resource.worker.js'), { name: 'fonts' });
  handle.dispose(); handle.dispose();
  assert.deepEqual(calls, [['https://assets.test/resource.worker.js', { name: 'fonts' }], 'terminate']);
});

test('webview workers fetch a self-contained package asset and revoke their own Blob URL', async () => {
  assert.equal(typeof factoryModule.createWorkerFactory, 'function');
  const calls = [];
  class Worker { constructor(url) { calls.push(url); } terminate() { calls.push('terminate'); } }
  const factory = factoryModule.createWorkerFactory({ mode: 'blob', Worker, fetch: async url => {
    calls.push(String(url)); return { ok: true, blob: async () => new Blob(['self.onmessage = () => {};']) };
  }, URL: { createObjectURL(blob) { assert.ok(blob.size); return 'blob:owned'; }, revokeObjectURL(url) { calls.push('revoke:' + url); } } });
  const handle = await factory('https://webview.test/resource.worker.js');
  handle.dispose(); handle.dispose();
  assert.deepEqual(calls, ['https://webview.test/resource.worker.js', 'blob:owned', 'terminate', 'revoke:blob:owned']);
});

test('failed webview construction releases its Blob URL and a failed fetch cannot start a Worker', async () => {
  assert.equal(typeof factoryModule.createWorkerFactory, 'function');
  const revoked = [];
  const factory = factoryModule.createWorkerFactory({ mode: 'blob', Worker: class { constructor() { throw new Error('CSP denied'); } }, fetch: async () => ({ ok: true, blob: async () => new Blob(['worker']) }),
    URL: { createObjectURL: () => 'blob:failed', revokeObjectURL: url => revoked.push(url) } });
  await assert.rejects(factory('https://webview.test/worker.js'), /CSP denied/);
  assert.deepEqual(revoked, ['blob:failed']);
  const failed = factoryModule.createWorkerFactory({ mode: 'blob', fetch: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(failed('https://webview.test/missing.js'), { code: 'WorkerUnavailable' });
});
