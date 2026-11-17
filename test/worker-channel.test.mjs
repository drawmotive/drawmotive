import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerChannel, serveWorkerRequests } from '../src/platform/worker-channel.js';
import { EditorError, exclusiveBuffers, fromErrorDescriptor, immutableSnapshot, toErrorDescriptor } from '../src/errors.js';

class Endpoint extends EventTarget {
  sent = [];
  transfers = [];
  postMessage(value, transfer = []) {
    // Record an independent copy: the delivered value may later be transferred onward.
    this.sent.push(structuredClone(value));
    this.transfers.push(transfer);
    const copy = structuredClone(value, { transfer });
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

test('Worker results move their exclusively owned buffers instead of cloning them', async t => {
  let produced;
  const { channel, scope } = await pair(t, { read: () => (produced = { payload: new Uint8Array([1, 2, 3]) }) });
  const result = await channel.request('read');
  assert.deepEqual([...result.payload], [1, 2, 3]);
  assert.equal(produced.payload.byteLength, 0, 'the Worker no longer owns the moved bytes');
  assert.equal(scope.transfers.at(-1).length, 1);
});

test('argument buffers move only when the caller gives up ownership', async t => {
  const { channel, worker } = await pair(t, { write: ({ bytes }) => bytes.length });
  const kept = new Uint8Array([1, 2]);
  assert.equal(await channel.request('write', { bytes: kept }), 2);
  assert.equal(kept.byteLength, 2);
  const moved = new Uint8Array([1, 2]);
  assert.equal(await channel.request('write', { bytes: moved }, { transfer: true }), 2);
  assert.equal(moved.byteLength, 0);
  assert.equal(worker.transfers.at(-1).length, 1);
});

test('views into larger or shared memory are never detached', () => {
  const heap = new ArrayBuffer(16);
  const whole = new Uint8Array(4);
  const value = { partial: new Uint8Array(heap, 4, 4), whole, again: whole, nested: [{ whole }],
    shared: new Uint8Array(new SharedArrayBuffer(4)), empty: new Uint8Array() };
  value.self = value;
  assert.deepEqual(exclusiveBuffers(value), [whole.buffer]);
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
test('owned snapshots move whole buffers while ordinary snapshots and partial views copy', () => {
  const argument = Uint8Array.of(1, 2);
  immutableSnapshot({ argument });
  assert.equal(argument.byteLength, 2);
  const owned = Uint8Array.of(3, 4), heap = new Uint8Array(new ArrayBuffer(8), 2, 2);
  const moved = immutableSnapshot({ owned, heap }, { transfer: true });
  assert.equal(owned.byteLength, 0);
  assert.deepEqual([...moved.owned], [3, 4]);
  assert.equal(heap.byteLength, 2, 'a view into larger memory is never detached');
});
