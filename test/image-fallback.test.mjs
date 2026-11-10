import assert from 'node:assert/strict';
import test from 'node:test';
const { convertUnsupportedImage } = await import('../src/platform/browser-image.js').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const b64 = bytes => Buffer.from(bytes).toString('base64');
function fixture({ png = [1,2,3,4], jpeg = [5,6], width = 8, height = 4, decode } = {}) {
  const calls = []; let closed = false, active = true;
  const bitmap = { width, height, close() { closed = true; } };
  const canvas = { width:0, height:0, getContext() { return { drawImage(value,x,y) { calls.push(['draw',value,x,y]); } }; },
    toBlob(done,type,quality) { calls.push(['encode',type,quality]); done(new Blob([Uint8Array.from(type === 'image/png' ? png : jpeg)], { type })); } };
  const window = { Blob, atob, btoa, createImageBitmap:async blob => { calls.push(['decode',blob.type,[...new Uint8Array(await blob.arrayBuffer())]]); return decode ? decode() : bitmap; }, document:{createElement:()=>canvas} };
  const run = (data = b64([9,8,7]), type = 'image/gif') => convertUnsupportedImage(data,type,{window,active:()=> { if (!active) throw Object.assign(new Error('Closed'),{code:'EditorDisposed'}); }});
  return {run,calls,canvas,window,get closed(){return closed;},close(){active=false;}};
}
test('browser fallback compares PNG with JPEG quality 0.8 and preserves the smaller encoded bytes',async()=>{
  assert.equal(typeof convertUnsupportedImage,'function');
  const h=fixture();assert.equal(await h.run(),b64([5,6]));
  assert.deepEqual(h.calls.filter(call=>call[0]==='encode'),[['encode','image/png',undefined],['encode','image/jpeg',0.8]]);
  assert.deepEqual(h.calls[0],['decode','image/gif',[9,8,7]]);assert.equal(h.closed,true);assert.equal(h.canvas.width,0);
  assert.equal(await fixture({png:[1],jpeg:[2,3]}).run(),b64([1]));
});
test('browser fallback reports unsupported decoding and bounds raster allocations before encoding',async()=>{
  await assert.rejects(fixture({decode(){throw new Error('Unsupported');}}).run(),{code:'UnsupportedImageFormat'});
  const h=fixture({width:20000});await assert.rejects(h.run(),{code:'InvalidArgument'});assert.equal(h.calls.some(call=>call[0]==='encode'),false);assert.equal(h.closed,true);
});
test('disposal during browser decoding closes its bitmap and prevents conversion',async()=>{
  let finish;const h=fixture({decode:()=>new Promise(resolve=>finish=resolve)});const pending=h.run();await new Promise(setImmediate);h.close();let closed=false;finish({width:8,height:4,close(){closed=true;}});
  await assert.rejects(pending,{code:'EditorDisposed'});assert.equal(closed,true);assert.equal(h.calls.some(call=>call[0]==='encode'),false);
});
test('public fallback recognizes SVG XML without changing its source bytes',async()=>{
 const h=fixture(),svg='<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>';
 await h.run(b64(Buffer.from(svg)),'');assert.deepEqual(h.calls[0],['decode','image/svg+xml',[...Buffer.from(svg)]]);
});
test('browser Image decoding recovers a rejected bitmap and releases its Blob URL',async()=>{
 const h=fixture({decode(){throw new Error('Bitmap cannot decode SVG');}}),urls=[];let image;
 h.window.URL={createObjectURL(blob){assert.equal(blob.type,'image/svg+xml');urls.push('created');return 'blob:svg';},revokeObjectURL(url){urls.push(url);}};
 h.window.Image=class {constructor(){image=this;this.naturalWidth=8;this.naturalHeight=4;}set src(value){this.source=value;if(value)queueMicrotask(()=>this.onload());}};
 assert.equal(await h.run(b64(Buffer.from('<svg/>')),'image/svg+xml'),b64([5,6]));
 assert.deepEqual(urls,['created','blob:svg']);assert.equal(image.source,'');assert.equal(h.canvas.width,0);
});
for(const disposed of [false,true]) test(`Image decoder ${disposed?'disposal':'failure'} releases its Blob URL and never encodes`,async()=>{
 const h=fixture({decode(){throw new Error('Unsupported bitmap');}});let image,revoked=false;
 h.window.URL={createObjectURL(){return 'blob:source';},revokeObjectURL(){revoked=true;}};
 h.window.Image=class {constructor(){image=this;}set src(value){this.source=value;}};
 const pending=h.run();void pending.catch(()=>{});await new Promise(setImmediate);
 if(disposed){h.close();image.onload();}else image.onerror(new Error('Unsupported image'));
 await assert.rejects(pending,{code:disposed?'EditorDisposed':'UnsupportedImageFormat'});assert.equal(revoked,true);assert.equal(image.source,'');assert.equal(h.calls.some(call=>call[0]==='encode'),false);
});
