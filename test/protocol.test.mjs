import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerChannel, serveWorkerRequests } from '../src/platform/worker-channel.js';
import { EditorError, fromErrorDescriptor, immutableSnapshot, toErrorDescriptor } from '../src/bridge/protocol.js';

class Endpoint extends EventTarget {
  sent = [];
  postMessage(value) {
    const copy = structuredClone(value);
    this.sent.push(copy);
    queueMicrotask(() => this.peer.dispatchEvent(new MessageEvent('message', { data: copy })));
  }
}
async function pair(t, handlers = {}, options = {}) {
  const worker = new Endpoint(), scope = new Endpoint();
  worker.peer = scope; scope.peer = worker;
  let released = 0;
  const stop = serveWorkerRequests(scope, { initialize: () => null, ...handlers }, options);
  const handle = await createWorkerChannel({ url: 'worker.js', timeoutMs: 1000, failureCode: 'WorkerFailed',
    workerFactory: async () => ({ worker, dispose() { released++; } }), ...options });
  t.after(() => { handle.dispose(); stop(); });
  return { ...handle, worker, scope, released: () => released };
}

test('dedicated Workers use only a request ID, method and structured args', async t => {
  const { channel, worker } = await pair(t, { echo: value => value });
  const bytes = new Uint8Array([1, 2]);
  assert.deepEqual(await channel.request('echo', { bytes }), { bytes });
  assert.deepEqual(worker.sent[1], { id: 2, method: 'echo', args: { bytes } });
  assert.deepEqual(Object.keys(worker.sent[0]), ['id', 'method', 'args']);
});

test('document Worker handlers execute in order and survive a rejected request', async t => {
  let release; const calls = [];
  const { channel } = await pair(t, {
    write: () => { calls.push('write'); return new Promise(resolve => { release = resolve; }); },
    read: () => { calls.push('read'); return 'saved'; },
  });
  const writing = channel.request('write');
  const reading = channel.request('read');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['write']);
  release(null); await writing;
  assert.equal(await reading, 'saved');
  await assert.rejects(channel.request('missing'), { code: 'UnknownMethod' });
  assert.equal(await channel.request('read'), 'saved');
});

test('resource Worker handlers can load independent fonts concurrently', async t => {
  let release;
  const { channel } = await pair(t, { slow: () => new Promise(resolve => { release = resolve; }), fast: () => 'font' }, { concurrent: true });
  const slow = channel.request('slow');
  assert.equal(await channel.request('fast'), 'font');
  release(null); await slow;
});

test('a commit timeout retains its eventual result without retrying the mutation', async t => {
  let release, calls = 0;
  const { channel } = await pair(t, { commit: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  let timeout;
  await assert.rejects(channel.request('commit', {}, { timeoutMs: 5 }), error => { timeout = error; return error.code === 'RequestTimeoutUnknown'; });
  release({ revision: 'r1' });
  assert.deepEqual(await timeout.completion, { result: { revision: 'r1' } });
  assert.equal(calls, 1);
});

test('malformed matching replies fail explicitly and disposal settles unknown completions', async t => {
  const { channel, scope, worker } = await pair(t, { stall: () => new Promise(() => {}) });
  const malformed = assert.rejects(channel.request('stall'), { code: 'InvalidRuntimeResponse' });
  await new Promise(resolve => setImmediate(resolve));
  scope.postMessage({ id: worker.sent.at(-1).id, result: 1, error: { code: 'Bad', message: 'Bad' } });
  await malformed;
  let timeout;
  await assert.rejects(channel.request('stall', {}, { timeoutMs: 5 }), error => { timeout = error; return error.code === 'RequestTimeoutUnknown'; });
  channel.dispose();
  assert.equal((await timeout.completion).error.code, 'EditorDisposed');
  await assert.rejects(channel.request('stall'), { code: 'EditorDisposed' });
});

for (const eventName of ['error', 'messageerror']) {
  test(eventName + ' rejects pending requests and releases the Worker once', async t => {
    const { channel, worker, dispose, released } = await pair(t, { stall: () => new Promise(() => {}) });
    const request = assert.rejects(channel.request('stall'), { code: 'WorkerFailed' });
    worker.dispatchEvent(new Event(eventName));
    await request; dispose(); dispose();
    assert.equal(released(), 1);
  });
}

test('Worker startup failures reject initialization and release ownership', async () => {
  let released = 0;
  const worker = new Endpoint(), scope = new Endpoint(); worker.peer = scope; scope.peer = worker;
  const stop = serveWorkerRequests(scope, { initialize: () => { throw Object.assign(new Error('Cannot start'), { code: 'StorageUnavailable' }); } });
  await assert.rejects(createWorkerChannel({ url: 'worker.js', workerFactory: async () => ({ worker, dispose() { released++; } }) }), { code: 'StorageUnavailable' });
  stop(); assert.equal(released, 1);
});

test('structured errors retain only code and message', () => {
  const error = new EditorError('StorageConflict', 'Changed', { secret: 'private' });
  assert.deepEqual(toErrorDescriptor(error), { code: 'StorageConflict', message: 'Changed' });
  assert.equal(fromErrorDescriptor(toErrorDescriptor(error)).code, 'StorageConflict');
});

test('snapshots reject shared memory including non-enumerable Error causes', () => {
  const shared = new SharedArrayBuffer(8);
  for (const value of [shared, new Uint8Array(shared), { nested: shared }, new Error('shared', { cause: shared })])
    assert.throws(() => immutableSnapshot(value), TypeError);
});
