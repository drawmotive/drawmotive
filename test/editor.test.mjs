import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { createEditor, EditorError } from '../src/index.js';

const initialState = () => ({ revision: 'generation-1:0', health: 'healthy', editingEnabled: true, busy: false, canUndo: false, canRedo: false });
const tick = () => new Promise(resolve => setImmediate(resolve));
function host(t, url = 'https://app.example/demo/') {
  const dom = new JSDOM('<div id="editor"></div>', { url });
  dom.window.MessageChannel = MessageChannel;
  const container = dom.window.document.querySelector('#editor');
  const ports = [];
  t.after(() => { ports.forEach(port => port.close()); dom.window.close(); });
  const options = { container, assetBaseUrl: 'https://runtime.example/editor/', startupTimeoutMs: 1000, requestTimeoutMs: 1000, disposeTimeoutMs: 30 };
  const frame = () => container.querySelector('iframe');
  const messages = [];
  const connections = [];
  let runtime;
  let operation = request => ({ result: request.method === 'getState' ? initialState() : null });
  const hello = (overrides = {}) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    source: frame().contentWindow, origin: 'https://runtime.example', data: { type: 'drawmotive:hello', protocolVersion: 2 }, ...overrides,
  }));
  function listen() {
    frame().contentWindow.postMessage = (message, origin, transferred) => {
      connections.push({ message, origin, transferred });
      runtime = transferred[0];
      ports.push(runtime);
      runtime.on('message', async request => {
        messages.push(request);
        if (request.type !== 'request') return;
        const response = await operation(request);
        if (response !== undefined) runtime.postMessage({ type: 'response', id: request.id, ...response });
      });
      runtime.start();
    };
  }
  const ready = (state = initialState(), version = 2) => runtime.postMessage({ type: 'ready', protocolVersion: version, state });
  const send = message => runtime.postMessage(message);
  const waitMessage = async predicate => {
    for (let i = 0; i < 100; i++) { const message = messages.find(predicate); if (message) return message; await new Promise(resolve => setTimeout(resolve, 1)); }
    assert.fail('Expected runtime message');
  };
  async function mount(extra = {}) {
    const promise = createEditor({ ...options, ...extra });
    listen(); hello(); ready();
    return promise;
  }
  return { dom, container, options, frame, messages, connections, hello, listen, ready, send, mount, waitMessage, operation: callback => { operation = callback; } };
}

test('connect binds one private port, sends frozen module/UI descriptors before readiness, and creates only a blank editor', async t => {
  const h = host(t);
  const handler = () => {};
  const promise = createEditor({ ...h.options, ui: { buttons: { redo: false }, actions: [{ id: 'host.save', label: 'Save', onInvoke: handler }] } });
  let resolved = false;
  promise.then(() => { resolved = true; });
  h.listen(); h.hello();
  await tick();
  assert.equal(resolved, false);
  const connection = h.connections[0];
  assert.equal(connection.origin, 'https://runtime.example');
  assert.equal(connection.message.type, 'drawmotive:connect');
  assert.equal(connection.message.protocolVersion, 2);
  assert.equal(connection.message.nonce, new URLSearchParams(new URL(h.frame().src).hash.slice(1)).get('nonce'));
  assert.equal(new URL(h.frame().src).search, '');
  assert.equal(new URL(h.frame().src).pathname, '/editor/embed.html');
  assert.deepEqual(connection.message.options.modules, { analytics: false, authentication: false, remoteSync: false });
  assert.equal(connection.message.options.ui.buttons.redo, false);
  assert.equal(connection.message.options.ui.buttons.help, false);
  assert.equal(connection.message.options.ui.buttons.rectangle, true);
  assert.deepEqual(connection.message.options.ui.actions, [{ id: 'host.save', label: 'Save', enabled: true, visible: true }]);
  assert.equal(h.messages.length, 0);
  h.ready();
  const editor = await promise;
  assert.equal(editor.lifecycle, 'ready');
  assert.equal(h.frame().title, 'DrawMotive diagram editor');
  await editor.dispose();
  assert.equal(h.frame(), null);
});

test('foreign windows/origins cannot connect and window responses cannot resolve private-port requests', async t => {
  const h = host(t);
  const promise = createEditor(h.options);
  h.listen();
  h.hello({ origin: 'https://other.example' });
  h.hello({ source: h.dom.window });
  assert.equal(h.connections.length, 0);
  h.hello(); h.hello();
  assert.equal(h.connections.length, 1);
  h.ready();
  const editor = await promise;
  h.operation(() => undefined);
  let resolved = false;
  const result = editor.exportSnapshot({ formats: ['raw'] }).then(value => { resolved = true; return value; });
  const request = await h.waitMessage(message => message.method === 'exportSnapshot');
  h.dom.window.dispatchEvent(new h.dom.window.MessageEvent('message', { source: h.frame().contentWindow, origin: 'https://runtime.example', data: { type: 'response', id: request.id, result: { raw: 'foreign' } } }));
  await tick();
  assert.equal(resolved, false);
  const snapshot = { revision: 'generation-1:0', raw: 'valid' };
  h.send({ type: 'response', id: request.id, result: snapshot });
  assert.deepEqual(await result, snapshot);
  h.operation(() => ({ result: null }));
  await editor.dispose();
});

test('a custom-scheme parent does not need HTTP origin parsing', async t => {
  const h = host(t, 'vscode-webview://instance-id/editor');
  const editor = await h.mount();
  assert.equal(h.connections[0].message.parentOrigin, undefined);
  await editor.dispose();
});

test('atomic methods use structured arguments and state subscription replays readiness and is isolated', async t => {
  const h = host(t);
  const editor = await h.mount();
  const observed = [];
  const unsubscribe = editor.onStateChanged(state => observed.push(state));
  assert.deepEqual(observed[0], initialState());
  const changed = { ...initialState(), revision: 'generation-1:1', canUndo: true };
  h.operation(request => ({ result: request.method === 'getState' ? changed : null, state: changed }));
  await editor.replaceDocument('raw');
  await editor.replacePngDocument('png');
  await editor.replaceTextGraph('A -> B');
  await editor.clearDocument();
  await editor.fitViewport({ padding: 0, minScale: .3, maxScale: 2 });
  await editor.setEditingEnabled(false);
  await editor.undo(); await editor.redo();
  assert.deepEqual(await editor.getState(), changed);
  assert.deepEqual(h.messages.slice(0, 3).map(message => message.args), [{ raw: 'raw' }, { base64: 'png' }, { source: 'A -> B' }]);
  assert.equal(observed.length, 2);
  assert.ok(Object.isFrozen(observed[1]));
  unsubscribe(); unsubscribe();
  h.send({ type: 'state', state: { ...changed, revision: 'generation-1:2' } });
  await tick(); assert.equal(observed.length, 2);
  await editor.dispose();
});

test('structured runtime errors leave the current instance available', async t => {
  const h = host(t);
  const editor = await h.mount();
  h.operation(request => request.method === 'replaceDocument' ? { error: { code: 'InvalidDocument', message: 'Invalid document' } } : { result: initialState() });
  await assert.rejects(editor.replaceDocument('bad'), error => error instanceof EditorError && error.code === 'InvalidDocument');
  assert.equal(editor.lifecycle, 'ready');
  assert.deepEqual(await editor.getState(), initialState());
  await editor.dispose();
});

test('an operation deadline retains the frame, never retries, and exposes its late result', async t => {
  const h = host(t);
  const editor = await h.mount({ requestTimeoutMs: 5 });
  h.operation(() => undefined);
  const result = editor.replaceDocument('slow');
  let failure;
  await assert.rejects(result, error => { failure = error; return error.code === 'RequestTimeoutUnknown'; });
  assert.equal(editor.lifecycle, 'ready');
  assert.ok(h.frame());
  assert.equal(h.messages.filter(message => message.method === 'replaceDocument').length, 1);
  h.send({ type: 'response', id: failure.requestId, result: null, state: { ...initialState(), revision: 'generation-2:0' } });
  assert.deepEqual(await failure.completion, { result: null });
  h.operation(request => ({ result: request.method === 'getState' ? { ...initialState(), revision: 'generation-2:0' } : null }));
  assert.equal((await editor.getState()).revision, 'generation-2:0');
  await editor.dispose();
});

test('startup abort, protocol mismatch, module rejection and missing runtime remove only the uncreated instance', async t => {
  const h = host(t);
  const controller = new AbortController();
  const aborted = createEditor({ ...h.options, signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  assert.equal(h.frame(), null);
  const incompatible = createEditor(h.options);
  h.listen(); h.hello({ data: { type: 'drawmotive:hello', protocolVersion: 1 } });
  await assert.rejects(incompatible, { code: 'ProtocolMismatch' });
  const rejected = createEditor({ ...h.options, modules: { analytics: true } });
  h.listen(); h.hello(); h.send({ type: 'error', error: { code: 'ModuleUnavailable', message: 'Module absent' } });
  await assert.rejects(rejected, { code: 'ModuleUnavailable' });
  await assert.rejects(createEditor({ ...h.options, startupTimeoutMs: 5 }), { code: 'StartupTimeout' });
  assert.equal(h.frame(), null);
});

test('reverse host actions can export and update their buttons without blocking forward requests', async t => {
  const h = host(t);
  let invoked = 0;
  h.operation(request => ({ result: request.method === 'exportSnapshot' ? { revision: 'generation-1:0', raw: 'raw' } : null }));
  const editor = await h.mount({ ui: { actions: [{ id: 'host.save', label: 'Save', async onInvoke({ editor, signal }) {
    invoked++; assert.equal(signal.aborted, false);
    assert.equal((await editor.exportSnapshot({ formats: ['raw'] })).raw, 'raw');
    await editor.setActionState('host.save', { label: '* Save', enabled: false });
  } }] } });
  h.send({ type: 'action', id: 'a1', actionId: 'host.save' });
  h.send({ type: 'action', id: 'a1', actionId: 'host.save' });
  const reply = await h.waitMessage(message => message.type === 'actionResult');
  assert.equal(invoked, 1);
  h.send({ type: 'action', id: 'a1', actionId: 'host.save' });
  await tick(); assert.equal(invoked, 1);
  assert.deepEqual(reply, { type: 'actionResult', id: 'a1', result: null });
  assert.deepEqual(h.messages.find(message => message.method === 'setActionState').args, { id: 'host.save', label: '* Save', enabled: false });
  await editor.dispose();
});

test('action failure is structured and a close action can dispose itself without waiting on its own handler', async t => {
  const h = host(t);
  let signal;
  const editor = await h.mount({ ui: { actions: [
    { id: 'host.fail', label: 'Fail', onInvoke() { throw new Error('Write failed'); } },
    { id: 'host.close', label: 'Close', async onInvoke(context) { signal = context.signal; await context.editor.dispose(); } },
  ] } });
  h.send({ type: 'action', id: 'fail', actionId: 'host.fail' });
  const reply = await h.waitMessage(message => message.id === 'fail');
  assert.deepEqual(reply.error, { code: 'HostActionFailed', message: 'Write failed' });
  h.send({ type: 'action', id: 'close', actionId: 'host.close' });
  await h.waitMessage(message => message.method === 'dispose');
  for (let i = 0; i < 10 && editor.lifecycle !== 'disposed'; i++) await tick();
  assert.equal(editor.lifecycle, 'disposed');
  assert.equal(signal.aborted, true);
  assert.equal(h.messages.some(message => message.type === 'actionResult' && message.id === 'close'), false);
});

test('bounded disposal rejects pending work, reports unconfirmed cleanup and stays idempotent', async t => {
  const h = host(t);
  const editor = await h.mount({ disposeTimeoutMs: 5 });
  h.operation(() => undefined);
  const pending = editor.exportSnapshot({ formats: ['raw'] });
  const rejected = assert.rejects(pending, { code: 'EditorDisposed' });
  const disposal = editor.dispose();
  assert.equal(editor.dispose(), disposal);
  await assert.rejects(disposal, { code: 'DisposeCleanupUnconfirmed' });
  await rejected;
  assert.equal(h.frame(), null);
  assert.equal(editor.lifecycle, 'disposed');
  await assert.rejects(editor.replaceTextGraph('A'), { code: 'EditorDisposed' });
  await assert.rejects(editor.dispose(), { code: 'DisposeCleanupUnconfirmed' });
});

test('a rejected runtime dispose still removes the frame, closes its port and preserves the cause', async t => {
  const h = host(t);
  const editor = await h.mount();
  h.operation(() => ({ error: { code: 'InteractionBusy', message: 'Finish the current interaction.' } }));
  const runtimePort = h.connections[0].transferred[0];
  const closed = new Promise(resolve => runtimePort.once('close', resolve));
  const disposal = editor.dispose();
  await assert.rejects(disposal, error => {
    assert.equal(error.code, 'DisposeCleanupUnconfirmed');
    assert.equal(error.cause.code, 'InteractionBusy');
    return true;
  });
  await closed;
  assert.equal(h.frame(), null);
  assert.equal(editor.lifecycle, 'disposed');
  assert.equal(editor.dispose(), disposal);
  await assert.rejects(editor.getState(), { code: 'EditorDisposed' });
});

test('creation and operation validation reject unknown or ambiguous options before any request', async t => {
  const h = host(t);
  const invalid = [
    { ui: { buttons: { save: true } } }, { modules: { product: true } }, { modules: { remoteSync: true } },
    { ui: { actions: [{ id: 'save', label: 'Save', onInvoke() {} }] } },
    { ui: { actions: [{ id: 'host.save', label: 'Save' }] } },
    { ui: { actions: [{ id: 'host.save', label: 'A', onInvoke() {} }, { id: 'host.save', label: 'B', onInvoke() {} }] } },
    { assetBaseUrl: 'javascript:alert(1)' }, { requestTimeoutMs: 0 }, { source: 'A -> B' },
  ];
  for (const options of invalid) await assert.rejects(createEditor({ ...h.options, ...options }), TypeError);
  assert.equal(h.frame(), null);
  const editor = await h.mount();
  for (const options of [{ formats: [] }, { formats: ['raw'], png: {} }, { formats: ['png', 'png'] }, { formats: ['svg'], render: { scale: Infinity } }]) await assert.rejects(editor.exportSnapshot(options), TypeError);
  await assert.rejects(editor.fitViewport({ minScale: 2 }), TypeError);
  await assert.rejects(editor.setActionState('host.unknown', {}), TypeError);
  assert.equal(h.messages.length, 0);
  await editor.dispose();
});


test('timed-out mutation errors remain correlated and disposal settles unknown outcomes', async t => {
  const h = host(t);
  const editor = await h.mount({ requestTimeoutMs: 5 });
  h.operation(() => undefined);
  let failure;
  await assert.rejects(editor.replaceDocument('slow'), error => { failure = error; return error.code === 'RequestTimeoutUnknown'; });
  h.send({ type: 'response', id: failure.requestId, error: { code: 'InvalidDocument', message: 'Rejected late' } });
  assert.equal((await failure.completion).error.code, 'InvalidDocument');
  let unknown;
  await assert.rejects(editor.undo(), error => { unknown = error; return error.code === 'RequestTimeoutUnknown'; });
  h.operation(() => ({ result: null }));
  await editor.dispose();
  assert.equal((await unknown.completion).error.code, 'EditorDisposed');
});

test('a pending host action is cancelled on page exit without waiting for its callback', async t => {
  const h = host(t);
  let actionSignal;
  const editor = await h.mount({ ui: { actions: [{ id: 'host.write', label: 'Write', onInvoke({ signal }) {
    actionSignal = signal;
    return new Promise(() => {});
  } }] } });
  h.send({ type: 'action', id: 'pending', actionId: 'host.write' });
  for (let i = 0; i < 10 && !actionSignal; i++) await tick();
  assert.equal(actionSignal.aborted, false);
  h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(editor.lifecycle, 'ready');
  h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pagehide', { persisted: false }));
  assert.equal(editor.lifecycle, 'disposed');
  assert.equal(actionSignal.aborted, true);
  assert.equal(h.frame(), null);
});
