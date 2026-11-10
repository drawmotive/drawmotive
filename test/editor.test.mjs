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
test('canvas session exposes independent text policy without web chrome',async t=>{
 const h=host(t),editor=await h.mount({textEditing:'external'});t.after(()=>editor.dispose());
 assert.deepEqual(h.context.options,{textEditing:'external'});
 assert.equal(editor.textEditing,'external');
 for(const name of ['ui','onUiChanged','invokeAction','setActionState'])assert.equal(editor[name],undefined);
});
test('deployment license keys reach native startup unchanged and stay out of public state',async t=>{
 const h=host(t);
 for(const licenseKey of ['', '  raw.not-a-jwt.key  ', 'x'.repeat(8193)]) {
  const editor=await h.mount({licenseKey});
  assert.equal(h.context.options.licenseKey,licenseKey);
  h.behavior(()=>state());assert.equal((await editor.getState()).licenseKey,undefined);
  assert.equal(editor.licenseKey,undefined);await editor.dispose();
 }
 const editor=await h.mount();assert.equal(Object.hasOwn(h.context.options,'licenseKey'),false);await editor.dispose();
});
test('license status reads native authority each time as a detached immutable snapshot',async t=>{
 const h=host(t),editor=await h.mount();t.after(()=>editor.dispose());
 let status={state:'free',reason:'invalid'};
 h.behavior(method=>{assert.equal(method,'getLicenseStatus');return status;});
 const first=await editor.getLicenseStatus();
 assert.deepEqual(first,{state:'free',reason:'invalid'});assert.ok(Object.isFrozen(first));assert.notEqual(first,status);
 status.reason='expired';assert.equal(first.reason,'invalid');
 assert.deepEqual(await editor.getLicenseStatus(),{state:'free',reason:'expired'});
 assert.deepEqual(h.calls,[{method:'getLicenseStatus',args:{}},{method:'getLicenseStatus',args:{}}]);
});
test('license status respects the document queue and rejects closing or disposed sessions',async t=>{
 const h=host(t),editor=await h.mount();let finish;
 h.behavior(method=>method==='undo'?new Promise(resolve=>finish=resolve):{state:'free',reason:'missing'});
 const edit=editor.undo(),status=editor.getLicenseStatus();await new Promise(setImmediate);
 assert.deepEqual(h.calls.map(call=>call.method),['undo']);
 const closing=editor.dispose();await assert.rejects(editor.getLicenseStatus(),{code:'EditorDisposed'});
 finish(null);await edit;assert.deepEqual(await status,{state:'free',reason:'missing'});await closing;
 await assert.rejects(editor.getLicenseStatus(),{code:'EditorDisposed'});
 const next=await h.mount();assert.equal(Object.hasOwn(h.context.options,'licenseKey'),false);await next.dispose();
});
test('disposal start notifies host lifetimes synchronously before blocked cleanup',async t=>{
 const h=host(t),editor=await h.mount({disposeTimeoutMs:1000});let release,events=0;
 h.cleanup(()=>new Promise(resolve=>release=resolve));
 editor.onEvent('disposing',()=>{events++;assert.equal(editor.lifecycle,'disposing');});
 const closing=editor.dispose();
 try {
  assert.equal(events,1);assert.equal(editor.dispose(),closing);
 } finally {await new Promise(setImmediate);release();await closing;}
});
test('public default entry is the canvas entry and rejects private chrome options',async t=>{
 const entry=await import('../src/index.js'),core=await import('../src/core.js');
 assert.equal(entry.createEditor,core.createEditor);
 const h=host(t);for(const ui of [false,{}, {buttons:{help:true}}])await assert.rejects(h.mount({ui}),/Unknown editor option: ui/);
 await assert.rejects(h.mount({textEditing:'react'}),/textEditing/);
});
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
test('native creation instructions survive state events and reads and clear on retirement',async t=>{
 const h=host(t),editor=await h.mount(),seen=[];t.after(()=>editor.dispose());
 editor.onStateChanged(value=>seen.push(value));
 h.context.emit('stateChanged',state({tool:'rectangle',prompt:'Press to set the first corner.'}));
 assert.equal(seen.at(-1).prompt,'Press to set the first corner.');
 h.behavior(()=>state({tool:'rectangle',busy:true,prompt:'Drag to the opposite corner, then release to finish.'}));
 const current=await editor.getState();assert.equal(current.prompt,'Drag to the opposite corner, then release to finish.');assert.ok(Object.isFrozen(current));
 h.context.emit('stateChanged',state({tool:'select',prompt:null}));assert.equal(seen.at(-1).prompt,null);
 h.context.emit('stateChanged',state());assert.equal(seen.at(-1).prompt,undefined);
});
test('malformed native instructions are rejected at the state boundary',async t=>{
 const h=host(t),editor=await h.mount();t.after(()=>editor.dispose());
 for(const prompt of [42,{},['invalid']]) {h.behavior(()=>state({prompt}));await assert.rejects(editor.getState(),{code:'InvalidRuntimeResponse'});}
});
test('platform callbacks remain independent while a document command awaits storage',async t=>{
 const h=host(t),editor=await h.mount();h.behavior(async method=>{if(method==='replaceDocument'){await h.context.platform('storage.open');return h.context.platform('storage.read');}});
 assert.equal(await editor.replaceDocument('raw'),null);await editor.dispose();
});
test('private composition supplies replication without extending the public handle',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});assert.equal(editor.replication,undefined);assert.equal(editor.sendCommand,undefined);assert.equal(h.context.options.initialEditingEnabled,false);
 h.behavior(method=>{assert.ok(!['replica.read','replica.ack'].includes(method));return method==='replica.readJournal'?{revision:'r1',clock:{author:1},journal:[{id:'author:1',payload:'Ag=='}]}:null;});await replication.establish();assert.deepEqual(await replication.read(),{clock:{},outbox:[],snapshotKey:'origin'});await replication.apply([]);await replication.acknowledge([]);
 let changes=0;replication.onChanged(()=>changes++);h.context.emit('stateChanged',state({revision:'next'}));assert.equal(changes,0);
 await h.context.platform('storage.commit',{batch:{batchId:'one',expectedRevision:null,checkpoint:{revision:'r1',payload:new Uint8Array([1]),clock:{author:1},snapshotAfterJournalId:null},journal:[{id:'author:1',payload:new Uint8Array([2])}],outbox:[{id:'author:1',revision:'r1',payload:new Uint8Array([2])}]}});
 assert.equal(changes,1);assert.deepEqual((await replication.read()).clock,{author:1});await replication.acknowledge(['author:1']);assert.deepEqual((await replication.read()).outbox,[]);
 assert.deepEqual(await replication.readJournal(),{revision:'r1',clock:{author:1},journal:[{id:'author:1',payload:new Uint8Array([2])}]});await editor.dispose();
 await assert.rejects(replication.readJournal(),{code:'EditorDisposed'});
});
test('startup platform preferences and cache status are retained',async t=>{
 const h=host(t);h.dom.window.localStorage.setItem('drawmotive.editor.preferences.v1','{"darkTheme":true}');const editor=await h.mount();assert.deepEqual(await h.context.platform('preferences.get'),{darkTheme:true});
 h.context.emit('fontCacheStatus',{path:'font.ttf',cache:'stored'});assert.deepEqual(editor.getFontCacheStatus(),[{path:'font.ttf',cache:'stored'}]);await editor.dispose();
});
test('private replication snapshots own decoded bytes and capture install/archive inputs before dispatch',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});t.after(()=>editor.dispose());
 assert.equal(editor.installSnapshot,undefined);assert.equal(editor.archive,undefined);
 const nativeSnapshot={payload:'AQID',clock:{author:2},key:'tx2'};
 h.behavior(method=>method==='replica.exportSnapshot'?nativeSnapshot:null);
 const exported=await replication.exportSnapshot();
 assert.ok(exported.payload instanceof Uint8Array);assert.deepEqual([...exported.payload],[1,2,3]);
 assert.deepEqual(exported.clock,{author:2});assert.equal(exported.key,'tx2');
 nativeSnapshot.clock.author=99;assert.equal(exported.clock.author,2);exported.payload[0]=7;
 const payload=new Uint8Array([4,5]),transactions=[{id:'one',payload:new Uint8Array([6])}],expectedClock={author:2};
 const installed=replication.installSnapshot(payload,expectedClock),archived=replication.archive(transactions);
 payload[0]=9;transactions[0].payload[0]=9;expectedClock.author=9;await installed;await archived;
 assert.deepEqual(h.calls,[{method:'replica.exportSnapshot',args:{}},
  {method:'replica.installSnapshot',args:{payload:new Uint8Array([4,5]),expectedClock:{author:2}}},
  {method:'replica.archive',args:{transactions:[{id:'one',payload:new Uint8Array([6])}]}}]);
});
test('private replication rejects malformed portable snapshot responses',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});t.after(()=>editor.dispose());
 for(const response of [null,{payload:'!!!',clock:{},key:'cut'},{payload:'AQ==',clock:null,key:'cut'},
  {payload:'AQ==',clock:{author:-1},key:'cut'},{payload:'AQ==',clock:{},key:42}]) {
  h.behavior(()=>response);await assert.rejects(replication.exportSnapshot(),{code:'InvalidRuntimeResponse'});
 }
});
test('private recovery journal forwards the captured server clock and preserves native suffix order and bytes',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});t.after(()=>editor.dispose());
 assert.equal(editor.readJournal,undefined);
 const origin='$origin:0123456789abcdef0123456789abcdef';
 const nativeJournal={revision:'r3',clock:{creator:3,editor:1},journal:[
  {id:'creator:2',payload:'AP8B'},{id:'editor:1',payload:'BA=='},{id:'creator:3',payload:'BQY='}
 ]};
 const physicalJournal=[
  {id:'creator:3',payload:new Uint8Array([5,6])},{id:'editor:1',payload:new Uint8Array([4])},
  {id:origin,payload:new Uint8Array([9])},{id:'creator:1',payload:new Uint8Array([2,3])},
  {id:'creator:2',payload:new Uint8Array([0,255,1])}
 ];
 await h.context.platform('storage.commit',{batch:{batchId:'cold-archive',expectedRevision:null,
  checkpoint:{revision:'r3',payload:new Uint8Array([9]),clock:{creator:3,editor:1},snapshotAfterJournalId:null},
  journal:physicalJournal,outbox:[]}});
 h.behavior(method=>{assert.equal(method,'replica.readJournal');return nativeJournal;});
 const serverClock={creator:1},reading=replication.readJournal(serverClock);serverClock.creator=99;
 const recovered=await reading;
 assert.deepEqual(recovered,{revision:'r3',clock:{creator:3,editor:1},journal:[
  {id:'creator:2',payload:new Uint8Array([0,255,1])},{id:'editor:1',payload:new Uint8Array([4])},
  {id:'creator:3',payload:new Uint8Array([5,6])}
 ]});
 assert.deepEqual(h.calls,[{method:'replica.readJournal',args:{clock:{creator:1}}}]);
 assert.deepEqual((await h.context.platform('storage.journal')).journal,physicalJournal);
 assert.ok(Object.isFrozen(recovered));assert.ok(Object.isFrozen(recovered.clock));
 assert.ok(Object.isFrozen(recovered.journal));assert.ok(Object.isFrozen(recovered.journal[0]));
 nativeJournal.clock.creator=99;nativeJournal.journal[0].payload='Bw==';
 assert.equal(recovered.clock.creator,3);assert.deepEqual([...recovered.journal[0].payload],[0,255,1]);
 recovered.journal[1].payload[0]=77;
 assert.deepEqual([...(await replication.readJournal({creator:1})).journal[1].payload],[4]);
});
test('private recovery journal accepts an empty native archive before the first checkpoint',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});t.after(()=>editor.dispose());
 h.behavior(method=>{assert.equal(method,'replica.readJournal');return {revision:null,clock:{},journal:[]};});
 assert.deepEqual(await replication.readJournal(),{revision:null,clock:{},journal:[]});
 assert.deepEqual(h.calls,[{method:'replica.readJournal',args:{clock:{}}}]);
});
test('private recovery journal rejects invalid server clocks before native dispatch',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});t.after(()=>editor.dispose());
 for(const clock of [null,[],new Date(),new Map(),new Uint8Array([1]),{author:-1},{author:2147483648},{author:1.5},{author:'1'},
  {' ':1},{'invalid:author':1},{['a'.repeat(129)]:1}]) {
  await assert.rejects(replication.readJournal(clock),TypeError);
 }
 assert.deepEqual(h.calls,[]);
});
test('private recovery journal rejects malformed native clocks, records and encoded bytes',async t=>{
 const h=host(t),{editor,replication}=await h.mount({}, {replication:true});t.after(()=>editor.dispose());
 const valid={revision:'r1',clock:{author:1},journal:[{id:'author:1',payload:'AQ=='}]};
 for(const response of [null,{...valid,revision:42},{...valid,revision:' '},
  {...valid,clock:null},{...valid,clock:[]},{...valid,clock:new Date()},
  {...valid,clock:new Map()},{...valid,clock:new Uint8Array([1])},{...valid,clock:{author:-1}},
  {...valid,clock:{author:2147483648}},{...valid,clock:{' ':1}},{...valid,clock:{author:1.5}},
  {...valid,clock:{'invalid:author':1}},
  {...valid,journal:null},{...valid,journal:[null]},
  {...valid,journal:[{id:' ',payload:'AQ=='}]},
  {...valid,journal:[{id:'author:1',payload:new Uint8Array([1])}]},
  {...valid,journal:[{id:'author:1',payload:'!!!'}]},
  {...valid,journal:[...valid.journal,...valid.journal]}]) {
  h.behavior(()=>response);await assert.rejects(replication.readJournal(),{code:'InvalidRuntimeResponse'});
 }
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
 const h=host(t),payload={version:2,data:'AQID'};h.behavior(method=>method==='copySelection'?payload:null);const editor=await h.mount();await editor.copyToClipboard({session:'s',version:1},{system:false});await editor.pasteFromClipboard({x:10,y:20},{source:'internal'});assert.deepEqual(h.calls.at(-1),{method:'pasteSelection',args:{payload,position:{x:10,y:20}}});await editor.dispose();
});
test('clipboard is retired before blocked native disposal completes',async t=>{
 const h=host(t);let release,access=0;
 Object.defineProperty(h.dom.window.navigator,'clipboard',{value:{readText(){access++;return Promise.resolve('drawmotive/selection:2\nAQID');},writeText(){access++;return Promise.resolve();}}});
 const editor=await h.mount({disposeTimeoutMs:1000});h.cleanup(()=>new Promise(resolve=>release=resolve));
 const closing=editor.dispose();await new Promise(setImmediate);
 try {
  await assert.rejects(editor.copyToClipboard({}),{code:'EditorDisposed'});
  await assert.rejects(editor.pasteFromClipboard({x:0,y:0}),{code:'EditorDisposed'});
  assert.equal(access,0);
 } finally {release();await closing;}
});
test('a pending copy provider cannot supply bytes after disposal begins',async t=>{
 const h=host(t);let finish,provider;
 Object.defineProperty(h.dom.window,'ClipboardItem',{value:class{constructor(data){this.data=data;}}});
 Object.defineProperty(h.dom.window.navigator,'clipboard',{value:{write(items){provider=items[0].data['text/plain'];return provider.then(()=>{});}}});
 h.behavior(()=>new Promise(resolve=>finish=resolve));const editor=await h.mount();
 const copying=editor.copyToClipboard({});void copying.catch(()=>{});await new Promise(setImmediate);
 const closing=editor.dispose();finish({version:2,data:'AQID'});
 await assert.rejects(copying,{code:'EditorDisposed'});await assert.rejects(provider,{code:'EditorDisposed'});await closing;
});
test('a pending paste cannot dispatch into a disposed or recreated editor',async t=>{
 const h=host(t);let read;
 Object.defineProperty(h.dom.window.navigator,'clipboard',{value:{readText:()=>new Promise(resolve=>read=resolve)}});
 h.behavior(method=>method==='getPointerPosition'?{x:1,y:2}:null);
 const first=await h.mount(),pending=first.pasteFromClipboard();void pending.catch(()=>{});await new Promise(setImmediate);await first.dispose();
 const second=await h.mount();read('drawmotive/selection:2\nAQID');await assert.rejects(pending,{code:'EditorDisposed'});
 assert.equal(h.calls.some(call=>call.method==='pasteSelection'),false);await second.dispose();
});
test('interaction methods dispatch semantic intent without native keyboard events',async t=>{
 const h=host(t),editor=await h.mount();t.after(()=>editor.dispose());
 await editor.cancelInteraction();await editor.beginPan();await editor.endPan();await editor.repeatLastTool();
 const modifiers={alt:true,shift:false};const update=editor.updateInteractionModifiers(modifiers);modifiers.alt=false;await update;
 assert.deepEqual(h.calls,[{method:'cancelInteraction',args:{}},{method:'beginPan',args:{}},{method:'endPan',args:{}},{method:'repeatLastTool',args:{}},{method:'updateInteractionModifiers',args:{alt:true,shift:false}}]);
 await assert.rejects(editor.updateInteractionModifiers({alt:'true',shift:false}),TypeError);
});
test('clipboard read starts before resolving native pointer placement',async t=>{
 const h=host(t),payload={version:2,data:'AQID'},order=[];
 Object.defineProperty(h.dom.window.navigator,'clipboard',{value:{readText(){order.push('system-read');return Promise.resolve('drawmotive/selection:2\nAQID');}}});
 h.behavior(method=>{order.push(method);return method==='getPointerPosition'?{x:12,y:34}:null;});
 const editor=await h.mount();t.after(()=>editor.dispose());
 const paste=editor.pasteFromClipboard();void paste.catch(()=>{});assert.deepEqual(order,['system-read']);await paste;
 assert.deepEqual(order,['system-read','getPointerPosition','pasteSelection']);
 assert.deepEqual(h.calls.at(-1),{method:'pasteSelection',args:{payload,position:{x:12,y:34}}});
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

test('generated scene snapshots expose unknown model properties as immutable values',async t=>{
 const h=host(t),editor=await h.mount();t.after(()=>editor.dispose());
 const scene={revision:'scene:7',metadata:{type:'DSceneMetadata',model:{title:'Example',style:0},schema:{type:'DSceneMetadata',properties:[],operations:[]}},items:[{id:'one',type:'FutureShape',model:{special:{futureSetting:37}},schema:{type:'FutureShape',properties:[],operations:[]}}]};
 h.behavior(method=>{assert.equal(method,'getScene');return scene;});
 assert.equal(typeof editor.getScene,'function');
 const result=await editor.getScene();
 assert.equal(result.items[0].model.special.futureSetting,37);
 assert.ok(Object.isFrozen(result.items[0].model.special));
 scene.items[0].model.special.futureSetting=41;assert.equal(result.items[0].model.special.futureSetting,37);
});

test('one scene edit forwards a detached batch without a property command vocabulary',async t=>{
 const h=host(t),editor=await h.mount();t.after(()=>editor.dispose());
 assert.equal(typeof editor.editScene,'function');assert.equal(editor.setProperty,undefined);
 const edit={revision:'scene:7',description:'Edit several objects',token:{session:'selection',version:3},changes:[
  {itemId:'one',path:['special','futureSetting'],value:37},
  {path:['title'],value:'Updated'},
  {itemId:'two',op:'remove',path:['xData','custom:label']},
  {itemId:'two',op:'call',path:['futureOperation'],arguments:[false,{label:'Example'}]},
 ]};
 const pending=editor.editScene(edit);edit.changes[0].value=99;edit.changes[3].arguments[1].label='Mutated';await pending;
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'editScene');
 assert.equal(h.calls[0].args.changes[0].value,37);assert.equal(h.calls[0].args.changes[3].arguments[1].label,'Example');
 assert.ok(Object.isFrozen(h.calls[0].args.changes));
});
