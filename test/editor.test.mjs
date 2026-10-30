import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEditorSession } from '../src/editor-session.js';
const state = (extra={}) => ({revision:null,health:'healthy',editingEnabled:true,busy:false,canUndo:false,canRedo:false,...extra});
function host(t) {
 const dom=new JSDOM('<div id="editor"></div>',{url:'https://app.example/diagrams/one'});t.after(()=>dom.window.close());
 const container=dom.window.document.getElementById('editor'),calls=[];let context,behavior=()=>null,dispose=async()=>{};
 const mountCanvas=async value=>{context=value;value.emit('ready',{state:state()});const canvas=dom.window.document.createElement('canvas');value.container.append(canvas);
 return {request:async(method,args)=>{calls.push({method,args});return behavior(method,args);},dispose:async()=>{await dispose();canvas.remove();}};};
 const options={container,assetBaseUrl:'https://assets.example/editor/',startupTimeoutMs:50,disposeTimeoutMs:50};
 return {dom,container,calls,options,get context(){return context;},behavior(fn){behavior=fn;},cleanup(fn){dispose=fn;},
 mount(extra={},privateOptions={}){return createEditorSession({...options,...extra},{runtimeLoader:async()=>({mountCanvas}),...privateOptions});}};
}
test('mounts one direct canvas and rejects a second editor without disturbing it',async t=>{
 const h=host(t),editor=await h.mount();assert.equal(h.container.querySelectorAll('canvas').length,1);assert.equal(h.container.querySelector('iframe'),null);
 assert.equal(editor.instanceId,undefined);assert.equal(editor.documentSessionId,undefined);await assert.rejects(h.mount(),{code:'EditorAlreadyMounted'});assert.equal(editor.lifecycle,'ready');
 await editor.dispose();await (await h.mount()).dispose();
});
test('semantic commands are ordered and immutable native events reach subscribers',async t=>{
 const h=host(t),editor=await h.mount(),seen=[];let finish;h.behavior(method=>method==='replaceDocument'?new Promise(resolve=>finish=resolve):state({revision:'new:1'}));
 const first=editor.replaceDocument('raw'),second=editor.getState();await new Promise(setImmediate);assert.equal(h.calls.length,1);finish(null);await first;assert.equal((await second).revision,'new:1');
 editor.onStateChanged(value=>seen.push(value));h.context.emit('stateChanged',state({revision:'new:2'}));assert.ok(Object.isFrozen(seen.at(-1)));await editor.dispose();
});
test('platform callbacks remain independent while a document command awaits storage',async t=>{
 const h=host(t),editor=await h.mount();h.behavior(async method=>{if(method==='replaceDocument'){await h.context.platform('storage.open');return h.context.platform('storage.read');}});
 assert.equal(await editor.replaceDocument('raw'),null);await editor.dispose();
});
test('private composition supplies replication without extending the public handle',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});assert.equal(editor.replication,undefined);assert.equal(editor.sendCommand,undefined);assert.equal(h.context.options.initialEditingEnabled,false);
 h.behavior(method=>method==='replica.read'?{outbox:[]}:null);await replication.establish();assert.deepEqual(await replication.read(),{outbox:[]});await replication.apply([]);await replication.acknowledge([]);
 let changes=0;replication.onChanged(()=>changes++);h.context.emit('stateChanged',state({busy:true}));h.context.emit('stateChanged',state());assert.equal(changes,0);h.context.emit('stateChanged',state({revision:'next'}));assert.equal(changes,1);await editor.dispose();
});
test('startup platform preferences and cache status are retained',async t=>{
 const h=host(t);h.dom.window.localStorage.setItem('drawmotive.editor.preferences.v1','{"darkTheme":true}');const editor=await h.mount();assert.deepEqual(await h.context.platform('preferences.get'),{darkTheme:true});
 h.context.emit('fontCacheStatus',{path:'font.ttf',cache:'stored'});assert.deepEqual(editor.getFontCacheStatus(),[{path:'font.ttf',cache:'stored'}]);await editor.dispose();
});
test('host actions can call document methods and close their own editor',async t=>{
 const h=host(t);h.behavior(()=>({raw:'raw'}));let signal;const editor=await h.mount({ui:{actions:[{id:'host.close',label:'Close',async onInvoke(context){signal=context.signal;assert.equal((await context.editor.exportSnapshot({formats:['raw']})).raw,'raw');await context.editor.dispose();}}]}});
 await editor.invokeAction('host.close');assert.equal(signal.aborted,true);assert.equal(editor.lifecycle,'disposed');
});
test('disposal waits pending commands and releases ownership only after cleanup',async t=>{
 const h=host(t),editor=await h.mount();let finish,release;h.behavior(()=>new Promise(resolve=>finish=resolve));h.cleanup(()=>new Promise(resolve=>release=resolve));
 const edit=editor.undo();await new Promise(setImmediate);const closing=editor.dispose();assert.equal(editor.dispose(),closing);await assert.rejects(h.mount(),{code:'EditorAlreadyMounted'});
 finish(null);await edit;await new Promise(setImmediate);assert.equal(editor.lifecycle,'disposing');release();await closing;assert.equal(h.container.childElementCount,0);h.cleanup(async()=>{});await (await h.mount()).dispose();
});
test('failed cleanup blocks successor creation and preserves its cause',async t=>{
 const h=host(t),editor=await h.mount(),failure=new Error('Native cleanup failed');h.cleanup(async()=>{throw failure;});await assert.rejects(editor.dispose(),error=>error.code==='DisposeCleanupUnconfirmed'&&error.cause===failure);await assert.rejects(h.mount(),{code:'EditorAlreadyMounted'});
});
test('stale notifications cannot affect a reopened document',async t=>{
 const h=host(t),first=await h.mount(),old=h.context;await first.dispose();const second=await h.mount();let seen;second.onStateChanged(value=>seen=value);old.emit('stateChanged',state({revision:'old'}));assert.equal(seen.revision,null);await second.dispose();
});
test('clipboard stays in JS and semantic payloads remain opaque',async t=>{
 const h=host(t),payload={version:1,data:'AQID'};h.behavior(method=>method==='copySelection'?payload:null);const editor=await h.mount();await editor.copyToClipboard({session:'s',version:1},{system:false});await editor.pasteFromClipboard({x:10,y:20},{source:'internal'});assert.deepEqual(h.calls.at(-1),{method:'pasteSelection',args:{payload,position:{x:10,y:20}}});await editor.dispose();
});
test('obsolete frame and transport options are rejected',async t=>{
 const h=host(t);for(const extra of [{frameDocument:{}},{requestTimeoutMs:5},{ui:{textEditing:'react'}},{assetBaseUrl:'javascript:bad'}])await assert.rejects(h.mount(extra),TypeError);const editor=await h.mount();await assert.rejects(editor.exportSnapshot({formats:[]}),TypeError);await assert.rejects(editor.fitViewport({minScale:2}),TypeError);await editor.dispose();
});
test('native semantic errors use the exported structured error class without losing the editor',async t=>{
 const {EditorError}=await import('../src/editor-session.js');const h=host(t),editor=await h.mount();h.behavior(()=>{throw Object.assign(new Error('Invalid diagram'),{code:'InvalidDocument'});});
 await assert.rejects(editor.replaceDocument('bad'),error=>error instanceof EditorError&&error.code==='InvalidDocument');h.behavior(()=>state());assert.equal((await editor.getState()).health,'healthy');await editor.dispose();
});
test('core canvas positions a static container and restores it after confirmed disposal',async t=>{
 const h=host(t);h.container.style.position='static';const editor=await h.mount();assert.equal(h.container.style.position,'relative');await editor.dispose();assert.equal(h.container.style.position,'static');
});
test('stalled native startup rejects within lifecycle deadlines and blocks uncertain reuse',async t=>{
 const h=host(t);const starting=h.mount({startupTimeoutMs:5,disposeTimeoutMs:5},{runtimeLoader:async()=>({mountCanvas:()=>new Promise(()=>{})})});
 const result=await Promise.race([starting.then(()=>null,error=>error),new Promise(resolve=>setTimeout(()=>resolve({code:'StillPending'}),80))]);assert.equal(result?.code,'DisposeCleanupUnconfirmed');await assert.rejects(h.mount(),{code:'EditorAlreadyMounted'});
});
