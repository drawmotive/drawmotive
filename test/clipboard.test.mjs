import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorClipboard, encodeSelection, decodeSelection } from '../src/platform/clipboard.js';
import { png } from './fixtures/clipboard-image.mjs';
const payload={version:1,data:'AQID'};
function fixture(options={}) {
 const calls=[];
 const editor={async copySelection(token,options){calls.push(['copy',token]);return {...payload,...(options?.png?{png}:{})};},async pasteSelection(data,point){calls.push(['paste',data,point]);return 'selection';},async pasteImage(data,point){calls.push(['image',data,point]);return 'image selection';},async deleteSelection(token){calls.push(['delete',token]);}};
 return {calls,editor,clipboard:createEditorClipboard(editor,options)};
}
test('selection decoding accepts the Windows CRLF envelope separator without changing graph bytes',()=>{
 assert.deepEqual(decodeSelection('drawmotive/selection:1\r\nAQID'),payload);
});
function item(data) {
 return {types:Object.keys(data),async getType(type){assert.ok(Object.hasOwn(data,type));return data[type];}};
}
function image(type='image/png') {return new Blob([Buffer.from(png,'base64')],{type});}
for(const type of ['image/png','image/jpeg','image/webp','image/gif','image/bmp','image/avif','image/svg+xml']) test(`rich system paste imports ${type} bytes without reading text`,async()=>{
 const h=fixture({clipboard:{async read(){return [item({[type]:image(type)})];},readText(){assert.fail('Rich access must own this read');}}});
 assert.equal(await h.clipboard.paste({x:3,y:7},{source:'system'}),'image selection');
 assert.deepEqual(h.calls,[['image',png,{x:3,y:7}]]);
});
test('a graph in a later clipboard item takes precedence over earlier PNG pixels',async()=>{
 const h=fixture({clipboard:{async read(){return [item({'image/png':image()}),item({'text/plain':new Blob(['drawmotive/selection:1\r\nAQID'])})];}}});
 assert.equal(await h.clipboard.paste({x:3,y:7}),'selection');
 assert.deepEqual(h.calls,[['paste',payload,{x:3,y:7}]]);
});
for(const separateItems of [false,true]) test(`rich paste preserves advertised JPEG bytes before a PNG alternative ${separateItems?'across items':'in the same item'}`,async()=>{
 const jpeg=new Blob([Uint8Array.of(1,2,3)],{type:'image/jpeg'});
 const items=separateItems?[item({'image/jpeg':jpeg}),item({'image/png':image()})]:[item({'image/jpeg':jpeg,'image/png':image()})];
 const h=fixture({clipboard:{async read(){return items;}}});
 await h.clipboard.paste({x:3,y:7});assert.deepEqual(h.calls,[['image','AQID',{x:3,y:7}]]);
});
test('external images remain importable with unrelated clipboard text',async()=>{
 const h=fixture({clipboard:{async read(){return [item({'text/plain':new Blob(['copied from another application']),'image/png':image()})];}}});
 await h.clipboard.paste({x:3,y:7});assert.deepEqual(h.calls,[['image',png,{x:3,y:7}]]);
});
for(const text of ['drawmotive/selection:1\n!','drawmotive/selection:2\nAQID']) test(`a rejected graph envelope cannot flatten into its PNG companion: ${JSON.stringify(text)}`,async()=>{
 const h=fixture({clipboard:{async read(){return [item({'image/png':image()}),item({'text/plain':new Blob([text])})];}}});
 await h.clipboard.copy({}, {system:false});
 await assert.rejects(h.clipboard.paste({x:1,y:2}),{code:'ClipboardFormatUnsupported'});
 assert.equal(h.calls.some(call=>call[0]==='paste'||call[0]==='image'),false);
});
for(const [name,items] of [['empty',[]],['text',[item({'text/plain':new Blob(['unrelated'])})]],['HTML',[item({'text/html':new Blob(['<b>unrelated</b>'])})]]]) test(`successful unrelated ${name} rich reads never use the internal copy`,async()=>{
 const h=fixture({clipboard:{async read(){return items;}}});await h.clipboard.copy({}, {system:false});
 await assert.rejects(h.clipboard.paste({x:1,y:2}),{code:'ClipboardFormatUnsupported'});
 assert.equal(h.calls.some(call=>call[0]==='paste'||call[0]==='image'),false);
});
test('malformed graph data in a later text item still rejects when another graph is valid',async()=>{
 const h=fixture({clipboard:{async read(){return [item({'text/plain':new Blob(['drawmotive/selection:1\nAQID'])}),item({'text/plain':new Blob(['drawmotive/selection:2\nAQID']),'image/png':image()})];}}});
 await assert.rejects(h.clipboard.paste({x:1,y:2}),{code:'ClipboardFormatUnsupported'});assert.deepEqual(h.calls,[]);
});
test('image conversion preserves bytes across encoding chunks',async()=>{
 const bytes=Uint8Array.from({length:256*1024+1},(_,index)=>index%251);
 const h=fixture({clipboard:{async read(){return [item({'image/png':new Blob([bytes])})];}}});
 await h.clipboard.paste({x:1,y:2});
 assert.deepEqual(new Uint8Array(Buffer.from(h.calls[0][1],'base64')),bytes);
});
test('oversized clipboard images reject before allocating their byte buffer',async()=>{
 const h=fixture({clipboard:{async read(){return [item({'image/avif':{size:16*1024*1024+1,arrayBuffer(){assert.fail('The source size must be bounded before reading');}}})];}}});
 await assert.rejects(h.clipboard.paste({x:1,y:2}),{code:'InvalidArgument'});assert.deepEqual(h.calls,[]);
});
test('rich clipboard preserves the source MIME for private browser fallback',async()=>{
 const calls=[],h=fixture({clipboard:{async read(){return [item({'image/svg+xml':new Blob(['<svg/>'],{type:'image/svg+xml'})})];}},pasteImage(...args){calls.push(args);}});
 await h.clipboard.paste({x:1,y:2});assert.deepEqual(calls,[[Buffer.from('<svg/>').toString('base64'),{x:1,y:2},'image/svg+xml']]);
});
test('a denied rich read uses the frozen automatic fallback and reports explicit system failure',async()=>{
 let deny;const h=fixture({clipboard:{read(){return new Promise((_,reject)=>deny=reject);},readText(){assert.fail('Denied rich reads must not start another system read');}}});
 await h.clipboard.copy(1,{system:false});const pending=h.clipboard.paste({x:1,y:2});
 h.editor.copySelection=async()=>({version:1,data:'BAUG'});await h.clipboard.copy(2,{system:false});
 deny(new Error('Denied'));await pending;assert.deepEqual(h.calls.at(-1),['paste',payload,{x:1,y:2}]);
 const system=h.clipboard.paste({x:1,y:2},{source:'system'});deny(new Error('Denied'));
 await assert.rejects(system,{code:'ClipboardPermissionDenied'});
});
test('rich read starts during the gesture before freezing native pointer placement',async()=>{
 let read,point={x:12,y:34};const order=[];
 const h=fixture({clipboard:{read(){order.push('read');return new Promise(resolve=>read=resolve);}},getPastePosition(){order.push('position');return Promise.resolve({...point});}});
 const pending=h.clipboard.paste();assert.deepEqual(order,['read','position']);
 point={x:90,y:80};read([item({'image/png':image()})]);await pending;assert.deepEqual(h.calls,[['image',png,{x:12,y:34}]]);
});
test('explicit image placement is frozen while the system read is pending',async()=>{
 let read;const point={x:4,y:8},h=fixture({clipboard:{read:()=>new Promise(resolve=>read=resolve)}});
 const pending=h.clipboard.paste(point);point.x=90;read([item({'image/png':image()})]);
 await pending;assert.deepEqual(h.calls,[['image',png,{x:4,y:8}]]);
});
test('disposal during image byte conversion rejects without inserting',async()=>{
 let finish;const converting=new Promise(resolve=>finish=resolve);
 const h=fixture({clipboard:{async read(){return [{types:['image/png'],async getType(){return {arrayBuffer(){return converting;}};}}];}}});
 const pending=h.clipboard.paste({x:1,y:2});void pending.catch(()=>{});await new Promise(setImmediate);
 h.clipboard.dispose();finish(Uint8Array.from([1,2,3]).buffer);
 await assert.rejects(pending,{code:'EditorDisposed'});assert.deepEqual(h.calls,[]);
});
test('disposal during rich item resolution rejects without inserting',async()=>{
 let finish;const h=fixture({clipboard:{async read(){return [{types:['image/png'],getType:()=>new Promise(resolve=>finish=resolve)}];}}});
 const pending=h.clipboard.paste({x:1,y:2});void pending.catch(()=>{});await new Promise(setImmediate);
 h.clipboard.dispose();finish(image());await assert.rejects(pending,{code:'EditorDisposed'});assert.deepEqual(h.calls,[]);
});
test('failed image byte conversion rejects instead of reviving an internal graph',async()=>{
 const h=fixture({clipboard:{async read(){return [{types:['image/png'],async getType(){return {async arrayBuffer(){throw new Error('Image read failed');}};}}];}}});
 await h.clipboard.copy({}, {system:false});await assert.rejects(h.clipboard.paste({x:1,y:2}),{message:'Image read failed'});
 assert.equal(h.calls.some(call=>call[0]==='paste'||call[0]==='image'),false);
});
for(const source of ['auto','system']) test(`${source} paste in another editor accepts a system copy with native CRLF conversion`,async()=>{
 let text;const system={async writeText(value){text=value.replaceAll('\n','\r\n');},async readText(){return text;}};
 const first=fixture({clipboard:system}),second=fixture({clipboard:system});
 assert.equal((await first.clipboard.copy({})).system,'written');
 assert.equal(await first.clipboard.paste({x:1,y:2},{source}),'selection');
 assert.equal(await second.clipboard.paste({x:3,y:4},{source}),'selection');
 assert.deepEqual(second.calls.at(-1),['paste',payload,{x:3,y:4}]);
});
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
 for(const raw of ['', 'drawmotive/selection:1\n!', encodeSelection(payload)+'\n',
  'drawmotive/selection:2\r\nAQID','drawmotive/selection:1\rAQID',
  'drawmotive/selection:1\r\n!','drawmotive/selection:1\r\nAQID\r\n',
  'drawmotive/selection:1\r\nAQ ID','drawmotive/selection:1\r\nAQ=ID']) assert.throws(()=>decodeSelection(raw),{code:'ClipboardFormatUnsupported'});
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
