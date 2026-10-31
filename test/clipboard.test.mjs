import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorClipboard, encodeSelection, decodeSelection } from '../src/platform/clipboard.js';
import { png } from './fixtures/clipboard-image.mjs';
const payload={version:1,data:'AQID'};
function fixture(options={}) {
 const calls=[];
 const editor={async copySelection(token,options){calls.push(['copy',token]);return {...payload,...(options?.png?{png}:{})};},async pasteSelection(data,point){calls.push(['paste',data,point]);return 'selection';},async deleteSelection(token){calls.push(['delete',token]);}};
 return {calls,editor,clipboard:createEditorClipboard(editor,options)};
}
test('system copy publishes PNG pixels and the lossless graph from one deferred capture',async()=>{
 let finish,written;const requests=[];
 const h=fixture({clipboard:{async write(items){written=items[0].data;}},ClipboardItem:class{constructor(data){this.data=data;}},Blob});
 h.editor.copySelection=(token,options)=>{requests.push({token,options});return new Promise(resolve=>finish=resolve);};
 const pending=h.clipboard.copy(7);assert.deepEqual(Object.keys(written).sort(),['image/png','text/plain']);
 assert.deepEqual(requests,[{token:7,options:{png:true}}]);finish({...payload,png});
 assert.equal((await pending).system,'written');
 const image=await written['image/png'];assert.equal(image.type,'image/png');
 assert.deepEqual(new Uint8Array(await image.arrayBuffer()),new Uint8Array(Buffer.from(png,'base64')));
 assert.equal(await (await written['text/plain']).text(),encodeSelection(payload));
 await h.clipboard.paste({x:1,y:2},{source:'internal'});assert.deepEqual(h.calls.at(-1)[1],payload);
});
test('an unavailable PNG provider preserves the valid internal graph and reports the failed system write',async()=>{
 const h=fixture({clipboard:{write(items){return Promise.all(Object.values(items[0].data));}},ClipboardItem:class{constructor(data){this.data=data;}},Blob});
 h.editor.copySelection=async()=>payload;
 assert.deepEqual(await h.clipboard.copy({}),{internal:true,system:'denied'});
 await h.clipboard.paste({x:1,y:2},{source:'internal'});assert.deepEqual(h.calls.at(-1)[1],payload);
});
test('system copy obtains browser permission before the asynchronous engine transfer resolves',async()=>{
 let finish,written,requested=false;const h=fixture({clipboard:{async write(items){requested=true;written=await items[0].data['text/plain'];await items[0].data['image/png'];}},ClipboardItem:class{constructor(data){this.data=data;}},Blob});
 h.editor.copySelection=()=>new Promise(resolve=>{finish=resolve;});const pending=h.clipboard.copy({session:'s',version:1});
 assert.equal(requested,true);finish({...payload,png});assert.deepEqual(await pending,{internal:true,system:'written'});assert.equal(await written.text(),encodeSelection(payload));
 assert.equal(await h.clipboard.paste({x:1,y:2},{source:'internal'}),'selection');assert.deepEqual(h.calls.at(-1),['paste',payload,{x:1,y:2}]);
});
test('internal copy and paste work without browser clipboard APIs and remain instance-owned',async()=>{
 const h=fixture(),other=fixture();assert.deepEqual(await h.clipboard.copy({}, {system:false}),{internal:true,system:'skipped'});
 await h.clipboard.paste({x:5,y:6},{source:'internal'});await assert.rejects(other.clipboard.paste({x:0,y:0},{source:'internal'}),{code:'ClipboardEmpty'});
 h.clipboard.dispose();await assert.rejects(h.clipboard.paste({x:0,y:0},{source:'internal'}),{code:'EditorDisposed'});
});
test('permission denial retains internal copy; unrelated OS text cannot paste an old selection',async()=>{
 let text;const h=fixture({clipboard:{async writeText(){throw new Error('Denied');},async readText(){if(text===undefined)throw new Error('Denied');return text;}}});
 assert.equal((await h.clipboard.copy({})).system,'denied');await h.clipboard.paste({x:0,y:0});
 text='unrelated text';await assert.rejects(h.clipboard.paste({x:0,y:0}),{code:'ClipboardFormatUnsupported'});
 text=encodeSelection(payload);await h.clipboard.paste({x:0,y:0},{source:'system'});
 assert.equal(h.calls.filter(call=>call[0]==='paste').length,2);
});
test('malformed payloads and in-flight copy after disposal never become an internal clipboard',async()=>{
 for(const raw of ['', 'drawmotive/selection:1\n!', encodeSelection(payload)+'\n']) assert.throws(()=>decodeSelection(raw),{code:'ClipboardFormatUnsupported'});
 const h=fixture();let finish;h.editor.copySelection=()=>new Promise(resolve=>finish=resolve);
 const pending=h.clipboard.copy({}, {system:false});h.clipboard.dispose();finish(payload);await assert.rejects(pending,{code:'EditorDisposed'});
});
test('a late first copy cannot replace the most recently requested internal selection',async()=>{
 const h=fixture();let first;h.editor.copySelection=token=>token===1?new Promise(resolve=>first=resolve):Promise.resolve({version:1,data:'BAUG'});
 const older=h.clipboard.copy(1,{system:false});await h.clipboard.copy(2,{system:false});first(payload);await older;
 await h.clipboard.paste({x:0,y:0},{source:'internal'});assert.equal(h.calls.at(-1)[1].data,'BAUG');
});
test('a denied ClipboardItem constructor and a failed transfer reject without an unhandled data promise',async()=>{
 const h=fixture({ClipboardItem:class{constructor(){throw new Error('Unsupported');}},clipboard:{write(){throw new Error('Unsupported');}},Blob});
 h.editor.copySelection=async()=>{throw new Error('Transfer failed');};await assert.rejects(h.clipboard.copy({}),{message:'Transfer failed'});
 await new Promise(resolve=>setImmediate(resolve));
});
test('automatic paste retains the fallback captured before a newer copy',async()=>{
 let deny;const h=fixture({clipboard:{readText:()=>new Promise((_,reject)=>deny=reject)}});
 await h.clipboard.copy(1,{system:false});
 const pending=h.clipboard.paste({x:1,y:2});
 h.editor.copySelection=async()=>({version:1,data:'BAUG'});await h.clipboard.copy(2,{system:false});
 deny(new Error('Denied'));await pending;assert.equal(h.calls.at(-1)[1].data,payload.data);
 await h.clipboard.paste({x:1,y:2},{source:'internal'});assert.equal(h.calls.at(-1)[1].data,'BAUG');
});
test('default target is captured after system access starts and before its delayed result',async()=>{
 let read,point={x:12,y:34};const order=[];
 const h=fixture({clipboard:{readText(){order.push('read');return new Promise(resolve=>read=resolve);}},getPastePosition(){order.push('position');return Promise.resolve({...point});}});
 const pending=h.clipboard.paste();assert.deepEqual(order,['read','position']);
 point={x:90,y:80};read(encodeSelection(payload));await pending;assert.deepEqual(h.calls.at(-1)[2],{x:12,y:34});
});
test('failed and malformed captures preserve the last successful internal copy',async()=>{
 const h=fixture();await h.clipboard.copy(1,{system:false});
 h.editor.copySelection=async()=>{throw new Error('Failed');};await assert.rejects(h.clipboard.copy(2,{system:false}),{message:'Failed'});
 h.editor.copySelection=async()=>({version:1,data:'!'});await assert.rejects(h.clipboard.copy(3,{system:false}),{code:'ClipboardFormatUnsupported'});
 await h.clipboard.paste({x:0,y:0},{source:'internal'});assert.deepEqual(h.calls.at(-1)[1],payload);
});
test('an early position rejection is consumed even when clipboard decoding fails',async()=>{
 let read;const h=fixture({clipboard:{readText:()=>new Promise(resolve=>read=resolve)},getPastePosition:()=>Promise.reject(new Error('Position failed'))});
 const pending=h.clipboard.paste();void pending.catch(()=>{});await new Promise(setImmediate);
 read('unrelated');await assert.rejects(pending,{code:'ClipboardFormatUnsupported'});await new Promise(setImmediate);
});
test('disposal between capture resolution and copy continuation prevents fallback system writes',async()=>{
 let finish,writes=0;const captured=new Promise(resolve=>finish=resolve);
 const h=fixture({clipboard:{writeText(){writes++;return Promise.resolve();}}});
 h.editor.copySelection=()=>captured;const pending=h.clipboard.copy({});
 void captured.then(()=>h.clipboard.dispose());finish(payload);
 await assert.rejects(pending,{code:'EditorDisposed'});assert.equal(writes,0);
});
test('disposal between capture resolution and Blob creation rejects the system byte provider',async()=>{
 let finish,provider;const captured=new Promise(resolve=>finish=resolve);
 const h=fixture({clipboard:{write(items){provider=items[0].data['text/plain'];return provider.then(()=>{});}},ClipboardItem:class{constructor(data){this.data=data;}},Blob});
 h.editor.copySelection=()=>captured;const pending=h.clipboard.copy({});
 void captured.then(()=>h.clipboard.dispose());finish(payload);
 await assert.rejects(pending,{code:'EditorDisposed'});await assert.rejects(provider,{code:'EditorDisposed'});
});
