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
