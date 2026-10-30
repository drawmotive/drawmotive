import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

const protocol = await import('../src/bridge/protocol.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const transport = await import('../src/bridge/runtime-channel.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const context = { instanceId: 'editor-1', documentSessionId: 'document-session-1' };

function contracts() {
  assert.equal(typeof protocol.createRequest, 'function', 'The versioned request contract must be available');
  assert.equal(typeof transport.createRuntimeChannel, 'function', 'The runtime channel must be available');
  return { ...protocol, ...transport };
}
function pair(t, options = {}) {
  const { createRuntimeChannel } = contracts();
  const { port1, port2 } = new MessageChannel();
  const left = createRuntimeChannel({ port: port1, ...context, requestTimeoutMs: 1000, ...options });
  const right = createRuntimeChannel({ port: port2, ...context, requestTimeoutMs: 1000, ...options });
  t.after(() => { left.dispose(); right.dispose(); });
  return { left, right };
}
function rawPeer(t, options = {}) {
  const { createRuntimeChannel } = contracts();
  const { port1, port2 } = new MessageChannel();
  const channel = createRuntimeChannel({ port: port1, ...context, requestTimeoutMs: 1000, ...options });
  port2.start();
  t.after(() => { channel.dispose(); port2.close(); });
  const next = () => new Promise(resolve => port2.once('message', resolve));
  return { channel, port: port2, next };
}

test('v3 messages correlate an instance, document session and request without legacy IDs', () => {
  const { createRequest, createResponse, createEvent, assertProtocolMessage, PROTOCOL_VERSION } = contracts();
  assert.equal(PROTOCOL_VERSION, 3);
  const args = { formats: ['raw'] };
  const request = createRequest({ ...context, requestId: 'request-1', method: 'exportSnapshot', args });
  assert.deepEqual(request, { protocolVersion: 3, type: 'request', lane: 'document', ...context, requestId: 'request-1', method: 'exportSnapshot', args });
  args.formats.push('png');
  assert.deepEqual(request.args.formats, ['raw']);
  assert.ok(Object.isFrozen(request.args.formats));
  const response = createResponse(request, { result: { revision: 'r1', raw: 'snapshot' } });
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.documentSessionId, request.documentSessionId);
  assert.equal(response.instanceId, request.instanceId);
  assert.equal(assertProtocolMessage(response), response);
  const event = createEvent({ ...context, name: 'stateChanged', data: { revision: 'r1' } });
  assert.equal(event.type, 'event');
  assert.equal('requestId' in event, false);
});

test('v2 and malformed or ambiguous envelopes are rejected before dispatch', () => {
  const { createRequest, assertProtocolMessage } = contracts();
  const request = createRequest({ ...context, requestId: 'r1', method: 'undo' });
  assert.throws(() => assertProtocolMessage({ ...request, protocolVersion: 2 }), { code: 'ProtocolMismatch' });
  for (const invalid of [
    { ...request, instanceId: '' }, { ...request, documentSessionId: undefined },
    { ...request, requestId: '' }, { ...request, lane: 'database' },
    { ...request, type: 'response', result: null, error: { code: 'InvalidDocument', message: 'Bad' } },
    { ...request, type: 'response', error: { code: 'InvalidDocument' } },
  ]) assert.throws(() => assertProtocolMessage(invalid), { code: 'InvalidMessage' });
});

test('structured errors retain public codes without serializing stack or callbacks', () => {
  const { EditorError, ERROR_CODES, toErrorDescriptor, fromErrorDescriptor } = contracts();
  assert.equal(ERROR_CODES.RequestTimeoutUnknown, 'RequestTimeoutUnknown');
  assert.equal(ERROR_CODES.StaleDocumentSession, 'StaleDocumentSession');
  assert.ok(Object.isFrozen(ERROR_CODES));
  const error = new EditorError('InvalidDocument', 'Cannot decode document', { requestId: 'r1', completion: Promise.resolve() });
  assert.deepEqual(toErrorDescriptor(error), { code: 'InvalidDocument', message: 'Cannot decode document' });
  assert.ok(fromErrorDescriptor(toErrorDescriptor(error)) instanceof EditorError);
  assert.equal(toErrorDescriptor(new Error('Host failed'), 'HostActionFailed').code, 'HostActionFailed');
  assert.equal(fromErrorDescriptor({ message: 'Missing code' }).code, 'InvalidRuntimeResponse');
});

test('document commands return immutable snapshots and structured handler failures', async t => {
  const { left, right } = pair(t);
  right.onRequest('exportSnapshot', (args, request) => {
    assert.deepEqual(args, { formats: ['raw'] });
    assert.equal(request.instanceId, context.instanceId);
    assert.equal(request.documentSessionId, context.documentSessionId);
    assert.equal(request.signal.aborted, false);
    return { revision: 'r1', raw: 'document' };
  });
  const snapshot = await left.request('exportSnapshot', { formats: ['raw'] });
  assert.deepEqual(snapshot, { revision: 'r1', raw: 'document' });
  assert.ok(Object.isFrozen(snapshot));
  right.onRequest('replaceDocument', () => { throw new protocol.EditorError('InvalidDocument', 'Invalid payload'); });
  await assert.rejects(left.request('replaceDocument', { raw: 'bad' }), { code: 'InvalidDocument', message: 'Invalid payload' });
  await assert.rejects(left.request('unknownMethod'), { code: 'UnknownMethod' });
});

test('document requests stay ordered while a platform request bypasses the document queue', async t => {
  const { left, right } = pair(t);
  const calls = [];
  let release;
  let started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  right.onRequest('first', async () => { calls.push('first'); started(); await new Promise(resolve => { release = resolve; }); return 1; });
  right.onRequest('second', () => { calls.push('second'); return 2; });
  right.onRequest('platformPing', () => 'pong', { lane: 'platform' });
  const first = left.request('first');
  await firstStarted;
  const second = left.request('second');
  assert.equal(await left.request('platformPing', {}, { lane: 'platform' }), 'pong');
  assert.deepEqual(calls, ['first']);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(calls, ['first', 'second']);
});

test('a reverse platform callback can export the document without deadlocking', async t => {
  const { left, right } = pair(t);
  right.onRequest('exportSnapshot', () => ({ revision: 'r1', raw: 'saved' }));
  left.onRequest('host.save', async () => {
    const snapshot = await left.request('exportSnapshot', { formats: ['raw'] });
    return snapshot.raw;
  }, { lane: 'platform' });
  assert.equal(await right.request('host.save', {}, { lane: 'platform' }), 'saved');
});

test('a timeout preserves the unknown outcome and settles its late completion without retrying', async t => {
  const { left, right } = pair(t);
  let release;
  let calls = 0;
  right.onRequest('commit', () => { calls++; return new Promise(resolve => { release = resolve; }); });
  let timeout;
  await assert.rejects(left.request('commit', { batch: 'opaque' }, { timeoutMs: 10 }), error => {
    timeout = error;
    return error instanceof protocol.EditorError && error.code === 'RequestTimeoutUnknown';
  });
  assert.equal(timeout.instanceId, context.instanceId);
  assert.equal(timeout.documentSessionId, context.documentSessionId);
  assert.equal(timeout.method, 'commit');
  assert.ok(timeout.requestId);
  release({ revision: 'r2' });
  assert.deepEqual(await timeout.completion, { result: { revision: 'r2' } });
  assert.equal(calls, 1);
});

test('expired document sessions reject pending work and cannot consume late responses', async t => {
  const { left, right } = pair(t);
  let release;
  right.onRequest('commit', () => new Promise(resolve => { release = resolve; }));
  let timeout;
  await assert.rejects(left.request('commit', {}, { timeoutMs: 10 }), error => { timeout = error; return error.code === 'RequestTimeoutUnknown'; });
  left.setDocumentSession('document-session-2');
  right.setDocumentSession('document-session-2');
  assert.equal((await timeout.completion).error.code, 'StaleDocumentSession');
  release({ revision: 'old' });
  right.onRequest('getState', () => ({ revision: 'new' }));
  assert.deepEqual(await left.request('getState'), { revision: 'new' });
});

test('an instance, session or lane mismatch never resolves an active request', async t => {
  const { channel, port, next } = rawPeer(t);
  const incoming = next();
  let resolved = false;
  const result = channel.request('getState').then(value => { resolved = true; return value; });
  const request = await incoming;
  const response = protocol.createResponse(request, { result: { revision: 'valid' } });
  port.postMessage({ ...response, instanceId: 'another-editor' });
  port.postMessage({ ...response, documentSessionId: 'expired-session' });
  port.postMessage({ ...response, lane: 'platform' });
  await tick();
  assert.equal(resolved, false);
  port.postMessage(response);
  assert.deepEqual(await result, { revision: 'valid' });
});

test('queued commands from an expired session do not run in the new document', async t => {
  const { left, right } = pair(t);
  let release;
  let started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  const calls = [];
  right.onRequest('first', async (_args, request) => { started(); await new Promise(resolve => { release = resolve; }); assert.equal(request.signal.aborted, true); return null; });
  right.onRequest('second', () => { calls.push('second'); });
  const first = assert.rejects(left.request('first'), { code: 'StaleDocumentSession' });
  await firstStarted;
  const second = assert.rejects(left.request('second'), { code: 'StaleDocumentSession' });
  left.setDocumentSession('new-session');
  right.setDocumentSession('new-session');
  release();
  await Promise.all([first, second]);
  await tick();
  assert.deepEqual(calls, []);
});

test('duplicate inbound request IDs execute one command and replay its response', async t => {
  const { channel, port, next } = rawPeer(t);
  let calls = 0;
  channel.onRequest('undo', () => { calls++; return { revision: 'r2' }; });
  const request = protocol.createRequest({ ...context, requestId: 'duplicate', method: 'undo' });
  const first = next();
  port.postMessage(request);
  port.postMessage(request);
  assert.equal((await first).result.revision, 'r2');
  const replay = next();
  port.postMessage(request);
  assert.equal((await replay).result.revision, 'r2');
  assert.equal(calls, 1);
});

test('state events are scoped to the current session and listener cleanup is idempotent', async t => {
  const { left, right } = pair(t);
  const events = [];
  let firstEvent;
  const received = new Promise(resolve => { firstEvent = resolve; });
  const unsubscribe = left.onEvent('stateChanged', value => { events.push(value); firstEvent(); });
  right.emit('stateChanged', { revision: 'r1' });
  await received;
  assert.ok(Object.isFrozen(events[0]));
  left.setDocumentSession('new-session');
  right.emit('stateChanged', { revision: 'old' });
  await tick();
  assert.equal(events.length, 1);
  unsubscribe(); unsubscribe();
  right.setDocumentSession('new-session');
  right.emit('stateChanged', { revision: 'r2' });
  await tick();
  assert.equal(events.length, 1);
});

test('abort and disposal settle pending outcomes and cancel active platform callbacks', async t => {
  const { left, right } = pair(t);
  let activeSignal;
  let started;
  const active = new Promise(resolve => { started = resolve; });
  right.onRequest('wait', (_args, request) => { activeSignal = request.signal; started(); return new Promise(() => {}); }, { lane: 'platform' });
  const controller = new AbortController();
  const aborted = assert.rejects(left.request('wait', {}, { lane: 'platform', signal: controller.signal }), { code: 'RequestAbortedUnknown' });
  await active;
  controller.abort();
  await aborted;
  right.dispose();
  assert.equal(activeSignal.aborted, true);
  left.dispose(); left.dispose();
  await assert.rejects(left.request('undo'), { code: 'EditorDisposed' });
});

test('disposal settles completion ownership for requests that already timed out', async t => {
  const { channel } = rawPeer(t);
  let timeout;
  await assert.rejects(channel.request('commit', {}, { timeoutMs: 5 }), error => { timeout = error; return error.code === 'RequestTimeoutUnknown'; });
  channel.dispose();
  assert.equal((await timeout.completion).error.code, 'EditorDisposed');
});

test('completed document response caching has a bounded count in a long-lived session', async t => {
  const { channel, port, next } = rawPeer(t, { maxCachedResponses: 2 });
  const calls = [];
  channel.onRequest('commit', args => { calls.push(args.batchId); return { revision: args.batchId }; });
  async function invoke(requestId) {
    const response = next();
    port.postMessage(protocol.createRequest({ ...context, requestId, method: 'commit', args: { batchId: requestId } }));
    await response;
  }
  for (const id of ['one', 'two', 'three', 'three', 'one']) await invoke(id);
  assert.deepEqual(calls, ['one', 'two', 'three', 'one']);
});

test('platform responses and responses exceeding the byte budget are not retained', async t => {
  const { channel, port, next } = rawPeer(t, { maxCachedResponseBytes: 16 });
  let documentCalls = 0;
  let platformCalls = 0;
  channel.onRequest('documentBytes', () => { documentCalls++; return new Uint8Array(32); });
  channel.onRequest('fontBytes', () => { platformCalls++; return new Uint8Array(32); }, { lane: 'platform' });
  async function invoke(method, lane) {
    const response = next();
    port.postMessage(protocol.createRequest({ ...context, requestId: method, method, lane }));
    assert.equal((await response).result.byteLength, 32);
  }
  await invoke('documentBytes', 'document');
  await invoke('documentBytes', 'document');
  await invoke('fontBytes', 'platform');
  await invoke('fontBytes', 'platform');
  assert.equal(documentCalls, 2);
  assert.equal(platformCalls, 2);
});

test('in-flight deduplication remains active when completed response caching is disabled', async t => {
  const { channel, port, next } = rawPeer(t, { maxCachedResponses: 0 });
  let calls = 0;
  let release;
  let started;
  const active = new Promise(resolve => { started = resolve; });
  channel.onRequest('commit', () => { calls++; started(); return new Promise(resolve => { release = resolve; }); });
  const request = protocol.createRequest({ ...context, requestId: 'in-flight', method: 'commit' });
  const response = next();
  port.postMessage(request);
  await active;
  port.postMessage(request);
  await tick();
  assert.equal(calls, 1);
  release(null);
  await response;
});

test('a stalled command from an expired session cannot block the next document session', async t => {
  const { left, right } = pair(t);
  let started;
  const active = new Promise(resolve => { started = resolve; });
  right.onRequest('stalled', () => { started(); return new Promise(() => {}); });
  const expired = assert.rejects(left.request('stalled'), { code: 'StaleDocumentSession' });
  await active;
  left.setDocumentSession('new-session');
  right.setDocumentSession('new-session');
  right.onRequest('getState', () => ({ revision: 'new' }));
  assert.deepEqual(await left.request('getState'), { revision: 'new' });
  await expired;
});

test('all event listeners receive an immutable envelope as well as immutable data', async t => {
  const { left, right } = pair(t);
  let observed;
  const received = new Promise(resolve => { observed = resolve; });
  left.onEvent('stateChanged', (_data, event) => {
    try { event.data.revision = 'mutated'; } catch {}
  });
  left.onEvent('stateChanged', (data, event) => observed({ data, event }));
  right.emit('stateChanged', { revision: 'original' });
  const { data, event } = await received;
  assert.equal(data.revision, 'original');
  assert.equal(event.data.revision, 'original');
  assert.ok(Object.isFrozen(event));
});

test('snapshot boundaries reject shared memory that cannot provide detached ownership', () => {
  contracts();
  const shared = new SharedArrayBuffer(8);
  for (const value of [shared, new Uint8Array(shared), { nested: new Uint8Array(shared) }, new Map([['shared', shared]])]) {
    assert.throws(() => protocol.immutableSnapshot(value), TypeError);
  }
});

test('response cache budgets count the complete backing buffer of a small binary view', async t => {
  const { channel, port, next } = rawPeer(t, { maxCachedResponseBytes: 2048 });
  let calls = 0;
  channel.onRequest('binaryView', () => { calls++; return new Uint8Array(new ArrayBuffer(8192), 1, 1); });
  const request = protocol.createRequest({ ...context, requestId: 'binary-view', method: 'binaryView' });
  for (let i = 0; i < 2; i++) {
    const response = next();
    port.postMessage(request);
    assert.equal((await response).result.byteLength, 1);
  }
  assert.equal(calls, 2);
});

test('response cache budgets include immutable Blob payload bytes', async t => {
  const { channel, port, next } = rawPeer(t, { maxCachedResponseBytes: 2048 });
  let calls = 0;
  channel.onRequest('blob', () => { calls++; return new Blob([new Uint8Array(4096)]); });
  const request = protocol.createRequest({ ...context, requestId: 'blob', method: 'blob' });
  for (let i = 0; i < 2; i++) {
    const response = next();
    port.postMessage(request);
    assert.equal((await response).result.size, 4096);
  }
  assert.equal(calls, 2);
});

test('snapshot ownership checks traverse non-enumerable Error causes', () => {
  contracts();
  const shared = new SharedArrayBuffer(8);
  for (const value of [
    new Error('shared buffer', { cause: shared }),
    new Error('shared view', { cause: new Uint8Array(shared) }),
    new Error('nested cause', { cause: new Error('inner', { cause: shared }) }),
  ]) assert.throws(() => protocol.immutableSnapshot(value), TypeError);
});

test('response cache budgets include binary payloads in non-enumerable Error causes', async t => {
  const { channel, port, next } = rawPeer(t, { maxCachedResponseBytes: 2048 });
  let calls = 0;
  channel.onRequest('errorValue', () => { calls++; return new Error('value', { cause: new Uint8Array(8192) }); });
  const request = protocol.createRequest({ ...context, requestId: 'error-value', method: 'errorValue' });
  for (let i = 0; i < 2; i++) {
    const response = next();
    port.postMessage(request);
    assert.equal((await response).result.cause.byteLength, 8192);
  }
  assert.equal(calls, 2);
});

test('aborting while request arguments are cloned prevents sending the request', async t => {
  const { left, right } = pair(t);
  const controller = new AbortController();
  let calls = 0;
  right.onRequest('echo', () => { calls++; return null; });
  right.onRequest('barrier', () => null);
  const args = { get value() { controller.abort('Cancelled during clone'); return 1; } };
  await assert.rejects(left.request('echo', args, { signal: controller.signal }), { code: 'RequestAborted' });
  await left.request('barrier');
  assert.equal(calls, 0);
});

test('an old repeated unsubscribe cannot remove a new event listener group', async t => {
  const { left, right } = pair(t);
  const old = left.onEvent('stateChanged', () => {});
  old();
  const observed = [];
  left.onEvent('stateChanged', value => observed.push(value));
  old();
  let resolveBarrier;
  const barrier = new Promise(resolve => { resolveBarrier = resolve; });
  left.onEvent('barrier', resolveBarrier);
  right.emit('stateChanged', { revision: 'new' });
  right.emit('barrier', null);
  await barrier;
  assert.deepEqual(observed, [{ revision: 'new' }]);
});

test('aborting after dispatch retains completion ownership without promising transaction cancellation', async t => {
  const { left, right } = pair(t);
  const controller = new AbortController();
  let release;
  let started;
  let requestSignal;
  let calls = 0;
  const active = new Promise(resolve => { started = resolve; });
  right.onRequest('commit', (_args, request) => {
    calls++;
    requestSignal = request.signal;
    started();
    return new Promise(resolve => { release = resolve; });
  });
  let failure;
  const rejected = assert.rejects(left.request('commit', {}, { signal: controller.signal }), error => {
    failure = error;
    return error.code === 'RequestAbortedUnknown';
  });
  await active;
  controller.abort('Stop waiting');
  await rejected;
  assert.equal(requestSignal.aborted, false);
  assert.equal(failure.method, 'commit');
  assert.equal(failure.instanceId, context.instanceId);
  assert.equal(failure.documentSessionId, context.documentSessionId);
  assert.ok(failure.requestId);
  release({ revision: 'committed' });
  assert.deepEqual(await failure.completion, { result: { revision: 'committed' } });
  assert.equal(calls, 1);
});

test('aborted unknown completions settle on session expiry and disposal', async t => {
  for (const action of ['expire', 'dispose']) {
    const { channel, next } = rawPeer(t);
    const controller = new AbortController();
    let failure;
    const dispatched = next();
    const rejected = assert.rejects(channel.request('commit', {}, { signal: controller.signal }), error => {
      failure = error;
      return error.code === 'RequestAbortedUnknown';
    });
    await dispatched;
    controller.abort();
    await rejected;
    if (action === 'expire') channel.setDocumentSession('new-session');
    else channel.dispose();
    assert.equal((await failure.completion).error.code, action === 'expire' ? 'StaleDocumentSession' : 'EditorDisposed');
  }
});

test('a document handler cannot start a reverse host action that could reenter its queue', async t => {
  const { left, right } = pair(t);
  const calls = [];
  right.onRequest('save', async () => {
    calls.push('save');
    return right.request('host.save', {}, { lane: 'platform' });
  });
  left.onRequest('host.save', async () => {
    calls.push('host.save');
    return left.request('exportSnapshot', { formats: ['raw'] });
  }, { lane: 'platform' });
  right.onRequest('exportSnapshot', () => { calls.push('exportSnapshot'); return { revision: 'r1', raw: 'snapshot' }; });
  await assert.rejects(left.request('save', {}, { timeoutMs: 50 }), { code: 'ReverseCallDuringDocumentCommand' });
  assert.deepEqual(calls, ['save']);
});

test('document handlers may await explicitly safe storage calls on the platform lane', async t => {
  const { left, right } = pair(t);
  left.onRequest('storage.commitBatch', () => ({ batchId: 'batch-1', revision: 'r1' }), { lane: 'platform' });
  right.onRequest('commit', () => right.request('storage.commitBatch', { batchId: 'batch-1' }, { lane: 'platform', documentSafe: true }));
  assert.deepEqual(await left.request('commit'), { batchId: 'batch-1', revision: 'r1' });
});

test('documentSafe is a boolean assertion restricted to the platform lane', async t => {
  const { left, right } = pair(t);
  right.onRequest('undo', () => null);
  right.onRequest('storage.read', () => null, { lane: 'platform' });
  await assert.rejects(left.request('undo', {}, { documentSafe: true }), TypeError);
  await assert.rejects(left.request('storage.read', {}, { lane: 'platform', documentSafe: 'yes' }), TypeError);
});
