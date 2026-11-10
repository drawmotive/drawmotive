import { test, expect } from '@playwright/test';

for (const [name,text,kind] of [
  ['image only',null,'image'],
  ['image with unrelated text','Copied from another application','image'],
  ['editable graph with PNG companion','drawmotive/selection:1\nAQID','graph'],
  ['future graph with PNG companion','drawmotive/selection:2\nAQID','error'],
]) test(`system clipboard paste preserves ${name}`,async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto('/test/browser/host.html');
  await page.evaluate(async text=>{
    const {createEditorClipboard}=await import('/src/platform/clipboard.js');
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=1;
    const drawing=canvas.getContext('2d');
    drawing.putImageData(new ImageData(new Uint8ClampedArray([255,0,0,255,0,0,255,255]),2,1),0,0);
    const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const data={'image/png':image};
    if(text!==null)data['text/plain']=new Blob([text],{type:'text/plain'});
    await navigator.clipboard.write([new ClipboardItem(data)]);
    // The real clipboard service owns format selection and byte conversion. A
    // native boundary sink records insertion intent without requiring WASM.
    const clipboard=createEditorClipboard({
      async pasteSelection(payload,position){return {kind:'graph',payload,position};},
      async pasteImage(data,position){
        const bytes=Uint8Array.from(atob(data),character=>character.charCodeAt(0));
        const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const drawing=canvas.getContext('2d');drawing.drawImage(image,0,0);image.close();
        return {kind:'image',position,width:canvas.width,height:canvas.height,pixels:[...drawing.getImageData(0,0,canvas.width,canvas.height).data]};
      },
    },{clipboard:navigator.clipboard});
    const paste=document.createElement('button');paste.textContent='Paste';
    paste.addEventListener('click',()=>{
      window.pasteResult=clipboard.paste({x:12,y:34},{source:'system'}).catch(error=>({kind:'error',code:error.code}));
    });
    document.body.append(paste);
  },text);
  await page.getByRole('button',{name:'Paste',exact:true}).click();
  const result=await page.evaluate(()=>window.pasteResult);
  expect(result.kind).toBe(kind);
  if(kind==='image')expect(result).toEqual({kind,position:{x:12,y:34},width:2,height:1,pixels:[255,0,0,255,0,0,255,255]});
  else if(kind==='graph')expect(result).toEqual({kind,payload:{version:1,data:'AQID'},position:{x:12,y:34}});
  else expect(result.code).toBe('ClipboardFormatUnsupported');
});

for (const {kind='solid',prolog='',name} of [
  {name:'simulated SVG clipboard fallback chooses smaller real browser PNG bytes'},
  {kind:'noise',name:'simulated SVG clipboard fallback chooses smaller real browser JPEG80 bytes'},
  {prolog:'<?xml version="1.0"?><!-- exported -->',name:'public SVG paste decodes an XML comment prolog'},
  {prolog:'<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',name:'public SVG paste decodes a DOCTYPE prolog'},
  {prolog:'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY note "quoted > and [ ]">]><!-- <svg is only a comment -->',name:'public SVG paste decodes an internal DOCTYPE subset'},
  {prolog:'<?xml version="1.0"?><!--'+ 'x'.repeat(1024*1024)+'-->',name:'public SVG paste decodes a root after a one MiB XML comment'},
]) test(name,async({page})=>{
  await page.goto('/test/browser/host.html');
  const result=await page.evaluate(async({kind,prolog})=>{
    const {createEditorSession}=await import('/src/editor-session.js');
    const width=64,height=64;let content='<rect width="64" height="64" fill="red"/>';
    if(kind==='noise'){
      let seed=1;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
      content=Array.from({length:width*height},(_,index)=>`<rect x="${index%width}" y="${Math.floor(index/width)}" width="1" height="1" fill="rgb(${next()},${next()},${next()})"/>`).join('');
    }
    const svg=new Blob([`${prolog}<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`],{type:'image/svg+xml'});
    const base64=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer()),chunks=[];for(let index=0;index<bytes.length;index+=32768)chunks.push(String.fromCharCode(...bytes.subarray(index,index+32768)));return btoa(chunks.join(''));};
    const original=await base64(svg);
    // Chromium cannot write SVG to the OS clipboard. Simulate only its read;
    // decoding, pixels and both competing encoders are real browser APIs.
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async read(){return [{types:['image/svg+xml'],async getType(){return svg;}}];}}});
    const image=new Image(),url=URL.createObjectURL(svg);image.src=url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0);image.src='';URL.revokeObjectURL(url);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));
    const expected=png.size<=jpeg.size?png:jpeg,requests=[];
    const container=document.createElement('div');container.className='editor';document.body.append(container);
    const editor=await createEditorSession({container,assetBaseUrl:'/runtime/'},{runtimeLoader:async()=>({mountCanvas:async context=>{
      context.emit('ready',{state:{revision:null,health:'healthy',editingEnabled:true,busy:false,canUndo:false,canRedo:false}});
      return {async request(method,args){requests.push({method,args});if(args.data===original)throw Object.assign(new Error('Native SVG decoder unavailable'),{code:'UnsupportedImageFormat'});return null;},async dispose(){}};
    }})});
    try {
      await editor.pasteFromClipboard({x:12,y:34},{source:'system'});
      await editor.pasteImage(original,{x:56,y:78});
      return {mime:expected.type,pngBytes:png.size,jpegBytes:jpeg.size,exact:requests[1].args.data===await base64(expected)&&requests[3].args.data===await base64(expected),positions:requests.map(value=>value.args.position),methods:requests.map(value=>value.method)};
    } finally {await editor.dispose();canvas.width=0;canvas.height=0;}
  },{kind,prolog});
  expect(result.mime).toBe(kind==='solid'?'image/png':'image/jpeg');expect(result.exact).toBe(true);
  expect(result.positions).toEqual([{x:12,y:34},{x:12,y:34},{x:56,y:78},{x:56,y:78}]);
  expect(result.methods).toEqual(['pasteImage','pasteImage','pasteImage','pasteImage']);
});
