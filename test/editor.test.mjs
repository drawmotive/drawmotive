import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { createEditor, EditorError } from '../src/core.js';
import { createEditorSession } from '../src/editor-session.js';
import { createRuntimeChannel } from '../src/bridge/runtime-channel.js';
const state = () => ({ revision: 'generation-1:0', health: 'healthy', editingEnabled: true, busy: false, canUndo: false, canRedo: false });
const methods = ['replaceDocument','replacePngDocument','replaceTextGraph','clearDocument','exportSnapshot','fitViewport','setEditingEnabled','undo','redo','getState','dispose','copySelection','pasteSelection','retryPersistence','getPreferences','setPreferences','replica.establish','replica.read','replica.apply','replica.ack'];
function host(t, url = 'https://app.example/demo/') {
  const dom = new JSDOM('<div id="editor"></div>', { url }); dom.window.MessageChannel = MessageChannel;
  const container = dom.window.document.querySelector('#editor'), channels = [], messages = [];
  let runtime, port, scope, connection, operation = request => ({ result: request.method === 'getState' ? state() : null });
  t.after(() => { channels.forEach(channel => channel.dispose()); dom.window.close(); });
  const options = { container, assetBaseUrl: 'https://runtime.example/editor/', startupTimeoutMs: 1000, requestTimeoutMs: 1000, disposeTimeoutMs: 30 };
  const frame = () => container.querySelector('iframe');
  function listen() { frame().contentWindow.postMessage = (message, origin, transferred) => {
    connection = { message, origin }; scope = { instanceId: message.instanceId, documentSessionId: message.documentSessionId };
    port = transferred[0]; port.addEventListener('message', event => messages.push(event.data));
    runtime = createRuntimeChannel({ port, ...scope }); channels.push(runtime);
    for (const method of methods) runtime.onRequest(method, async args => {
      const response = await operation({ method, args });
      if (response === undefined) return new Promise(() => {});
      if (response.error) throw new EditorError(response.error.code, response.error.message);
      if (response.state) runtime.emit('stateChanged', response.state);
      return response.result;
    });
  }; }
  const hello = (overrides = {}) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    source: frame().contentWindow, origin: 'https://runtime.example', data: { type: 'drawmotive:hello', protocolVersion: 3 }, ...overrides,
  }));
  const ready = () => runtime.emit('ready', { state: state() });
  async function mount(extra = {}) { const pending = createEditor({ ...options, ...extra }); listen(); hello(); ready(); return pending; }
  return { dom, container, options, frame, hello, listen, ready, mount, messages,
    get connection() { return connection; }, get runtime() { return runtime; }, operation(callback) { operation = callback; },
    respond(request, outcome) { port.postMessage({ ...scope, protocolVersion: 3, type: 'response', lane: request.lane, requestId: request.requestId, ...outcome }); },
  };
}
test('v3 bootstrap binds one private port; full descriptors contain no functions or site modules', async t => {
  const h = host(t), pending = createEditor({ ...h.options, ui: { textEditing: 'external', regions: { topLeft: false }, actions: [{ id: 'host.save', label: 'Save', onInvoke() {} }] } });
  let resolved = false; void pending.then(() => { resolved = true; }); h.listen(); h.hello();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(resolved, false);
  assert.equal(h.connection.message.protocolVersion, 3); assert.equal(h.connection.origin, 'https://runtime.example');
  assert.ok(h.connection.message.instanceId); assert.ok(h.connection.message.documentSessionId);
  assert.equal(h.connection.message.options.ui.textEditing, 'external'); assert.equal(h.connection.message.options.ui.actions[0].onInvoke, undefined);
  assert.equal(h.connection.message.options.modules, undefined); assert.equal(h.messages.length, 0);
  h.ready(); const editor = await pending; assert.equal(editor.ui.regions.topLeft.visible, false);
  await editor.dispose(); assert.equal(h.frame(), null);
});
test('source, origin and version are authenticated before readiness', async t => {
  const h = host(t), pending = createEditor(h.options); h.listen(); h.hello({ origin: 'https://foreign.example' }); h.hello({ source: h.dom.window });
  assert.equal(h.connection, undefined); h.hello(); const first = h.connection; h.hello(); assert.equal(h.connection, first);
  h.ready(); await (await pending).dispose();
  const mismatch = createEditor(h.options); h.listen(); h.hello({ data: { type: 'drawmotive:hello', protocolVersion: 2 } });
  await assert.rejects(mismatch, { code: 'ProtocolMismatch' }); assert.equal(h.frame(), null);
});
test('private source composition supplies a separate replication handle without extending the public editor', async t => {
  const h = host(t);
  const pending = createEditorSession(h.options, { replication: true });
  h.listen(); h.hello(); h.ready();
  const { editor, replication } = await pending;
  assert.equal(editor.replication, undefined);
  assert.equal(editor.sendCommand, undefined);
  assert.equal(h.connection.message.options.initialEditingEnabled, false);
  const value = { clock: { author: 1 }, outbox: [{ id: 'author:1', payload: new Uint8Array([1, 2]) }] };
  h.operation(({ method }) => ({ result: method === 'replica.read' ? value : null }));
  await replication.establish();
  assert.deepEqual(await replication.read(), value);
  await replication.apply(value.outbox);
  await replication.acknowledge(['author:1']);
  assert.deepEqual(h.messages.slice(-4).map(message => message.method), ['replica.establish','replica.read','replica.apply','replica.ack']);
  assert.deepEqual(h.messages.at(-2).args, { transactions: value.outbox });
  let changes = 0;
  const off = replication.onChanged(() => { changes++; });
  h.runtime.emit('stateChanged', { ...state(), revision: 'changed:1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(changes >= 1);
  off(); await editor.dispose();
  await assert.rejects(replication.read(), { code: 'EditorDisposed' });
  const publicEditor = await h.mount();
  assert.equal(publicEditor.replication, undefined);
  assert.equal(h.connection.message.options.initialEditingEnabled, undefined);
  await publicEditor.dispose();
});
test('host document retains nonce and authenticates independently of asset origin', async t => {
  const h = host(t), pending = createEditor({ ...h.options, frameDocument: { url: 'https://app.example/bootstrap.html', html: '<div id="app"></div>' } });
  const hash = new URL(h.frame().src).hash; h.frame().dispatchEvent(new h.dom.window.Event('load'));
  assert.equal(h.frame().contentDocument.querySelector('#app').id, 'app'); assert.equal(h.frame().contentWindow.location.hash, hash);
  h.listen(); h.hello(); assert.equal(h.connection, undefined); h.hello({ origin: 'https://app.example' }); h.ready(); await (await pending).dispose();
});
test('custom-scheme parent can host an HTTP asset runtime', async t => { const h = host(t, 'vscode-webview://instance/editor'); await (await h.mount()).dispose(); });
test('document commands and immutable state changes use the same private v3 channel', async t => {
  const h = host(t), editor = await h.mount(), observed = [], unsubscribe = editor.onStateChanged(value => observed.push(value));
  const changed = { ...state(), revision: 'generation-1:1', canUndo: true };
  h.operation(request => ({ result: request.method === 'getState' ? changed : null, state: changed }));
  await editor.replaceDocument('raw'); await editor.replacePngDocument('png'); await editor.replaceTextGraph('A -> B'); await editor.clearDocument();
  await editor.fitViewport({ padding: 0 }); await editor.setEditingEnabled(false); await editor.undo(); await editor.redo();
  assert.deepEqual(await editor.getState(), changed); assert.equal(observed.length, 2); assert.ok(Object.isFrozen(observed[1]));
  assert.deepEqual(h.messages.slice(0, 3).map(message => message.args), [{ raw: 'raw' }, { base64: 'png' }, { source: 'A -> B' }]);
  assert.ok(h.messages.every(message => message.protocolVersion === 3 && message.lane === 'document'));
  unsubscribe(); unsubscribe(); await editor.dispose();
});
test('reverse storage requests work before .NET ready and keep host-owned identity', async t => {
  const h = host(t), pending = createEditor(h.options); h.listen(); h.hello();
  const session = await h.runtime.request('storage.open', { namespace: 'untrusted' }, { lane: 'platform', documentSafe: true });
  assert.equal(session.instanceId, h.connection.message.instanceId); assert.equal(session.namespace, 'temporary');
  const checkpoint = { revision: 'checkpoint:1', payload: new Uint8Array([5,6]) };
  await h.runtime.request('storage.commit', { batch: { batchId: 'batch-1', expectedRevision: null, checkpoint, outbox: [] } }, { lane: 'platform', documentSafe: true });
  assert.deepEqual(await h.runtime.request('storage.read', {}, { lane: 'platform', documentSafe: true }), checkpoint);
  h.ready(); await (await pending).dispose();
});
test('preference reverse calls use the owning host window storage before readiness', async t => {
  const h = host(t);
  h.dom.window.localStorage.setItem('drawmotive.editor.preferences.v1', '{"darkTheme":true}');
  const pending = createEditor(h.options); h.listen(); h.hello();
  assert.deepEqual(await h.runtime.request('preferences.get', {}, { lane: 'platform', documentSafe: true }), { darkTheme: true });
  await h.runtime.request('preferences.update', { snapToGrid: false }, { lane: 'platform', documentSafe: true });
  h.ready(); await (await pending).dispose();
  assert.deepEqual(JSON.parse(h.dom.window.localStorage.getItem('drawmotive.editor.preferences.v1')), { darkTheme: true, snapToGrid: false });
});
test('font cache status observed during startup remains available after readiness', async t => {
  const h = host(t), pending = createEditor(h.options); h.listen(); h.hello();
  h.runtime.emit('fontCacheStatus', { path: 'static/font.ttf', cache: 'unavailable', detail: 'OPFS unavailable' });
  h.ready(); const editor = await pending;
  const status = editor.getFontCacheStatus();
  assert.deepEqual(status, [{ path: 'static/font.ttf', cache: 'unavailable', detail: 'OPFS unavailable' }]);
  assert.ok(Object.isFrozen(status)); assert.ok(Object.isFrozen(status[0]));
  await editor.dispose();
});
test('deadline retains instance and correlated late outcome without retry', async t => {
  const h = host(t), editor = await h.mount({ requestTimeoutMs: 5 }); h.operation(() => undefined);
  let failure; await assert.rejects(editor.replaceDocument('slow'), error => { failure = error; return error.code === 'RequestTimeoutUnknown'; });
  assert.equal(editor.lifecycle, 'ready'); assert.ok(h.frame()); const request = h.messages.find(message => message.requestId === failure.requestId);
  assert.equal(h.messages.length, 1); h.respond(request, { result: null }); assert.deepEqual(await failure.completion, { result: null });
  await assert.rejects(editor.dispose(), { code: 'DisposeCleanupUnconfirmed' });
});
test('runtime errors preserve current instance', async t => {
  const h = host(t), editor = await h.mount(); h.operation(request => request.method === 'replaceDocument' ? { error: { code: 'InvalidDocument', message: 'Bad file' } } : { result: state() });
  await assert.rejects(editor.replaceDocument('bad'), error => error instanceof EditorError && error.code === 'InvalidDocument');
  assert.deepEqual(await editor.getState(), state()); await editor.dispose();
});
test('host action can export outside document lane and update parent UI locally', async t => {
  const h = host(t); let count = 0; h.operation(request => ({ result: request.method === 'exportSnapshot' ? { revision: state().revision, raw: 'raw' } : null }));
  const editor = await h.mount({ ui: { actions: [{ id: 'host.save', label: 'Save', async onInvoke({ editor, signal }) {
    count++; assert.equal(signal.aborted, false); assert.equal((await editor.exportSnapshot({ formats: ['raw'] })).raw, 'raw'); await editor.setActionState('host.save', { label: 'Saved', enabled: false });
  } }] } });
  await h.runtime.request('host.action', { id: 'host.save' }, { lane: 'platform' }); assert.equal(count, 1); assert.equal(editor.ui.actions[0].label, 'Saved');
  assert.equal(h.messages.some(message => message.method === 'setActionState'), false);
  await assert.rejects(editor.invokeAction('host.save'), { code: 'ActionUnavailable' }); await editor.dispose();
});
test('host errors are structured and a close action can dispose itself', async t => {
  const h = host(t); let signal; const editor = await h.mount({ ui: { actions: [
    { id: 'host.fail', label: 'Fail', onInvoke() { throw new Error('Write failed'); } },
    { id: 'host.close', label: 'Close', async onInvoke(context) { signal = context.signal; await context.editor.dispose(); } },
  ] } });
  await assert.rejects(editor.invokeAction('host.fail'), { code: 'HostActionFailed', message: 'Write failed' });
  await editor.invokeAction('host.close'); assert.equal(signal.aborted, true); assert.equal(editor.lifecycle, 'disposed');
});
test('UI lifecycle subscribers are released for dispose and pagehide', async t => {
  for (const reason of ['dispose', 'pagehide']) {
    const h = host(t), editor = await h.mount();
    const observed = []; const remove = editor.onDisposed(() => observed.push([editor.lifecycle, h.frame()]));
    const removed = editor.onDisposed(() => { throw new Error('Unsubscribed callback must not execute'); }); removed();
    if (reason === 'dispose') await editor.dispose();
    else h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));
    assert.deepEqual(observed, [['disposed', null]]);
    remove(); await editor.dispose(); assert.equal(observed.length, 1);
  }
});
test('host JS clipboard holds opaque graph bytes and pastes through the existing semantic lane',async t=>{
  const h=host(t),payload={version:1,data:'AQID'};h.operation(request=>({result:request.method==='copySelection'?payload:null}));
  const editor=await h.mount();const token={session:'selection',version:1};
  assert.deepEqual(await editor.copyToClipboard(token,{system:false}),{internal:true,system:'skipped'});
  await editor.pasteFromClipboard({x:10,y:20},{source:'internal'});
  assert.deepEqual(h.messages.filter(message=>message.type==='request').map(message=>({method:message.method,args:message.args})),[
    {method:'copySelection',args:{token}},{method:'pasteSelection',args:{payload,position:{x:10,y:20}}},
  ]);
  await editor.dispose();await assert.rejects(editor.pasteFromClipboard({x:0,y:0},{source:'internal'}),{code:'EditorDisposed'});
});
test('system clipboard denial does not prevent startup or internal copy',async t=>{
  const h=host(t);Object.defineProperty(h.dom.window.navigator,'clipboard',{get(){throw new Error('Denied by host');}});
  h.operation(request=>({result:request.method==='copySelection'?{version:1,data:'AQID'}:null}));
  const editor=await h.mount();assert.equal((await editor.copyToClipboard({session:'s',version:1})).system,'unavailable');await editor.dispose();
});
test('persistence recovery is an explicit document-lane command',async t=>{
  const h=host(t),editor=await h.mount();await editor.retryPersistence();
  assert.equal(h.messages.length,1);assert.equal(h.messages[0].method,'retryPersistence');assert.equal(h.messages[0].lane,'document');await editor.dispose();
});
test('preference subscribers observe authoritative runtime values and late updates after a deadline',async t=>{
  const h=host(t),editor=await h.mount({requestTimeoutMs:5}),observed=[];
  const first=new Promise(resolve=>editor.onPreferencesChanged(value=>{observed.push(value);resolve(value);}));
  h.runtime.emit('preferencesChanged',{darkTheme:true,showGrid:false,snapToGrid:false});
  assert.deepEqual(await first,{darkTheme:true,showGrid:false,snapToGrid:false});assert.ok(Object.isFrozen(observed[0]));
  let finish;h.operation(()=>new Promise(resolve=>finish=resolve));let unknown;await assert.rejects(editor.setPreferences({darkTheme:false}),error=>{unknown=error;return error.code==='RequestTimeoutUnknown';});
  const next=new Promise(resolve=>{const stop=editor.onPreferencesChanged(value=>{if(value.darkTheme===false){stop();resolve(value);}});});
  h.runtime.emit('preferencesChanged',{darkTheme:false,showGrid:false,snapToGrid:false});finish({result:null});await unknown.completion;await next;
  h.operation(()=>({result:null}));await editor.dispose();
});
test('bounded disposal settles outstanding outcomes, preserves cause and is idempotent', async t => {
  const h = host(t), editor = await h.mount({ requestTimeoutMs: 5, disposeTimeoutMs: 5 }); h.operation(() => undefined);
  let unknown; await assert.rejects(editor.undo(), error => { unknown = error; return error.code === 'RequestTimeoutUnknown'; });
  const disposal = editor.dispose(); assert.equal(editor.dispose(), disposal); await assert.rejects(disposal, error => { assert.equal(error.code, 'DisposeCleanupUnconfirmed'); assert.equal(error.cause.code, 'RequestTimeoutUnknown'); return true; });
  assert.equal((await unknown.completion).error.code, 'EditorDisposed'); assert.equal(editor.lifecycle, 'disposed'); assert.equal(h.frame(), null);
  await assert.rejects(editor.getState(), { code: 'EditorDisposed' });
});
test('startup abort, failure and timeout remove the uncreated frame', async t => {
  const h = host(t), controller = new AbortController(), pending = createEditor({ ...h.options, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(h.frame(), null);
  const failure = createEditor(h.options); h.listen(); h.hello(); h.runtime.emit('failed', { code: 'ResourceUnavailable', message: 'Offline font unavailable' });
  await assert.rejects(failure, { code: 'ResourceUnavailable' }); await assert.rejects(createEditor({ ...h.options, startupTimeoutMs: 5 }), { code: 'StartupTimeout' });
});
test('startup rejection waits for its outstanding platform cleanup before releasing ownership',async t=>{
 const h=host(t),controller=new AbortController();let release,entered;
 const factoryEntered=new Promise(resolve=>entered=resolve);
 t.after(()=>release?.());
 const pending=createEditor({...h.options,signal:controller.signal,disposeTimeoutMs:1000,workerFactory:()=>{entered();return new Promise((_resolve,reject)=>release=()=>reject(new Error('Cancelled resource factory')));}});
 let settled=false;void pending.catch(()=>{settled=true;});h.listen();h.hello();
 void h.runtime.request('fonts.load',{path:'font.ttf',url:'https://runtime.example/font.ttf',sha256:'a'.repeat(64)},{lane:'platform',documentSafe:true}).catch(()=>{});
 await factoryEntered;controller.abort();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.frame(),null);assert.equal(settled,false,'A rejected startup still owns its pending platform resources.');
 release();await assert.rejects(pending,{name:'AbortError'});
});
test('startup cleanup deadline reports unconfirmed ownership instead of an ordinary abort',async t=>{
 const h=host(t),controller=new AbortController();let release,entered;
 const factoryEntered=new Promise(resolve=>entered=resolve);
 const pending=createEditor({...h.options,signal:controller.signal,disposeTimeoutMs:5,workerFactory:()=>{entered();return new Promise((_resolve,reject)=>release=()=>reject(new Error('Cancelled resource factory')));}});
 void pending.catch(()=>{});h.listen();h.hello();
 void h.runtime.request('fonts.load',{path:'font.ttf',url:'https://runtime.example/font.ttf',sha256:'a'.repeat(64)},{lane:'platform',documentSafe:true}).catch(()=>{});
 await factoryEntered;controller.abort();
 try{await assert.rejects(pending,error=>error.code==='DisposeCleanupUnconfirmed'&&error.cause?.name==='AbortError');}
 finally{release();}
});
test('invalid creation and command inputs fail before sending', async t => {
  const h = host(t); for (const extra of [{ modules: {} }, { ui: { buttons: { save: true } } }, { ui: { textEditing: 'react' } }, { assetBaseUrl: 'javascript:bad' }, { persistence: { mode: 'persistent' } }, { requestTimeoutMs: 0 }, { source: 'A -> B' }]) await assert.rejects(createEditor({ ...h.options, ...extra }), TypeError);
  assert.equal(h.frame(), null); const editor = await h.mount();
  for (const value of [{ formats: [] }, { formats: ['raw'], png: {} }, { formats: ['png','png'] }, { formats: ['svg'], render: { scale: Infinity } }]) await assert.rejects(editor.exportSnapshot(value), TypeError);
  await assert.rejects(editor.fitViewport({ minScale: 2 }), TypeError); await assert.rejects(editor.setActionState('host.missing', {}), TypeError);
  for (const preferences of [null, [], { darkTheme: null }, { darkTheme: 'yes' }, { accountToken: 'invalid' }])
    await assert.rejects(editor.setPreferences(preferences), TypeError);
  assert.equal(h.messages.length, 0); await editor.dispose();
});
test('page exit cancels host action; bfcache pagehide preserves the instance', async t => {
  const h = host(t); let signal; const editor = await h.mount({ ui: { actions: [{ id: 'host.pending', label: 'Pending', onInvoke(context) { signal = context.signal; return new Promise(() => {}); } }] } });
  void editor.invokeAction('host.pending'); assert.equal(signal.aborted, false);
  h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pagehide', { persisted: true })); assert.equal(editor.lifecycle, 'ready');
  h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pagehide', { persisted: false })); assert.equal(signal.aborted, true); assert.equal(editor.lifecycle, 'disposed'); assert.equal(h.frame(), null);
});

test('disposal is owned before synchronous action abort listeners can reenter it', async t => {
  const h = host(t); let reentered;
  const editor = await h.mount({ ui: { actions: [{ id: 'host.pending',label: 'Pending',onInvoke({ editor,signal }) {
    return new Promise(resolve => signal.addEventListener('abort',() => { reentered = editor.dispose(); resolve(); },{ once: true }));
  } }] } });
  const action = editor.invokeAction('host.pending');
  const disposal = editor.dispose();
  assert.equal(reentered,disposal);
  await Promise.all([action,disposal]);
  assert.equal(h.messages.filter(message => message.method === 'dispose').length,1);
});

test('MessageChannel construction failures reject startup immediately and remove the frame', async t => {
  const h = host(t), failure = new Error('Ports unavailable');
  h.dom.window.MessageChannel = class { constructor() { throw failure; } };
  const pending = createEditor({ ...h.options,startupTimeoutMs: 20 }); h.listen(); h.hello();
  await assert.rejects(pending,error => error === failure);
  assert.equal(h.frame(),null);
});
test('an abort dispatched by a creation option getter cannot be lost before listener registration', async t => {
  const h = host(t), controller = new AbortController();
  const pending = createEditor({ ...h.options,startupTimeoutMs: 20,signal: controller.signal,
    get persistence() { controller.abort(); return { mode: 'memory' }; },
  });
  await assert.rejects(pending,{ name: 'AbortError' });
  assert.equal(h.frame(),null);
});
test('host callbacks preserve completion ownership of uncertain document requests', async t => {
  const h = host(t), editor = await h.mount({ requestTimeoutMs: 5,ui: { actions: [{ id: 'host.save',label: 'Save',async onInvoke({ editor }) {
    await editor.replaceDocument('slow');
  } }] } });
  h.operation(() => undefined);
  let failure;
  await assert.rejects(editor.invokeAction('host.save'),error => { failure = error; return error.code === 'RequestTimeoutUnknown'; });
  assert.ok(failure.requestId); assert.ok(failure.completion);
  h.respond(h.messages.find(message => message.requestId === failure.requestId),{ result: null });
  assert.deepEqual(await failure.completion,{ result: null });
  await assert.rejects(editor.dispose(),{ code: 'DisposeCleanupUnconfirmed' });
});
