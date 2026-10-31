import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorClipboard, encodeSelection, decodeSelection } from '../src/platform/clipboard.js';
const payload={version:1,data:'AQID'};
function fixture(options={}) {
 const calls=[];
 const editor={async copySelection(token){calls.push(['copy',token]);return {...payload};},async pasteSelection(data,point){calls.push(['paste',data,point]);return 'selection';},async deleteSelection(token){calls.push(['delete',token]);}};
 return {calls,editor,clipboard:createEditorClipboard(editor,options)};
}
test('system copy obtains browser permission before the asynchronous engine transfer resolves',async()=>{
 let finish,written,requested=false;const h=fixture({clipboard:{async write(items){requested=true;written=await items[0].data['text/plain'];}},ClipboardItem:class{constructor(data){this.data=data;}},Blob});
 h.editor.copySelection=()=>new Promise(resolve=>{finish=resolve;});const pending=h.clipboard.copy({session:'s',version:1});
 assert.equal(requested,true);finish(payload);assert.deepEqual(await pending,{internal:true,system:'written'});assert.equal(await written.text(),encodeSelection(payload));
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
