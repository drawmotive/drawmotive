import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
test.use({launchOptions:{executablePath:process.env.DRAWMOTIVE_CHROMIUM_PATH}});

for(const phase of ['ready','starting','unconfirmed'])test('React recreation preserves persistent writer ownership during '+phase,async({page})=>{
 let requested,release;const fontRequested=new Promise(resolve=>requested=resolve),fontGate=new Promise(resolve=>release=resolve);
 const documentWorkers=[];page.on('worker',worker=>{if(worker.url().endsWith('/document.worker.js'))documentWorkers.push(worker.url());});
 await page.route('**/review-font.ttf',async route=>{requested();await fontGate;await route.fulfill({contentType:'font/ttf',body:Buffer.from([1,2,3])});});
 const fixture=await build({stdin:{contents:
  'import {createElement} from "react";import {createRoot} from "react-dom/client";import {Editor} from "./src/react/index.tsx";'+
  'globalThis.reactStart=options=>{const target=document.createElement("div");target.style="width:640px;height:420px";document.body.append(target);const root=createRoot(target);globalThis.readyEditors=[];globalThis.errors=[];const callbacks={onReady:e=>readyEditors.push(e),onError:e=>errors.push({code:e.code,message:e.message})};globalThis.changeUi=ui=>root.render(createElement(Editor,{...options,ui,...callbacks}));globalThis.unmount=()=>root.unmount();root.render(createElement(Editor,{...options,...callbacks}));};',
  resolveDir:fileURLToPath(new URL('../..',import.meta.url)),sourcefile:'react-wrapper-fixture.js'},write:false,outfile:'react-wrapper-fixture.js',bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic'});
 await page.route('**/react-wrapper-fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture.outputFiles.find(file=>file.path.endsWith('.js')).text}));
 await page.route('**/stub-runtime/embed.html*',route=>route.fulfill({contentType:'text/html',body:
  '<!doctype html><script type="module">import {createRuntimeChannel} from "/src/bridge/runtime-channel.js";const nonce=new URLSearchParams(location.hash.slice(1)).get("nonce");'+
  'addEventListener("message",async event=>{const m=event.data;if(m?.nonce!==nonce)return;const channel=createRuntimeChannel({port:event.ports[0],instanceId:m.instanceId,documentSessionId:m.documentSessionId});'+
  'for(const method of ["dispose","getPreferences","getSelection"])channel.onRequest(method,async()=>{if(method==="dispose"){await new Promise(r=>setTimeout(r,1500));return null;}if(method==="getPreferences")return {};return {token:{session:"s",version:1},items:[],properties:{},anchor:null};});'+
  'try{await channel.request("storage.open",{}, {lane:"platform",documentSafe:true});'+
  (phase==='ready'?'':'await channel.request("fonts.load",{path:"review-font.ttf",url:new URL("/review-font.ttf",location.href).href,sha256:"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"},{lane:"platform",documentSafe:true});')+
  'channel.emit("ready",{state:{revision:"r0",health:"healthy",editingEnabled:true,busy:false,canUndo:false,canRedo:false}});}catch(e){try{channel.emit("failed",{code:e.code,message:e.message});}catch{}}});parent.postMessage({type:"drawmotive:hello",protocolVersion:3},"*");</script>'}));
 await page.goto('/test/browser/host.html');await page.addStyleTag({url:'/dist/editor-ui.css'});
 await page.evaluate(async phase=>{await import('/react-wrapper-fixture.js');reactStart({assetBaseUrl:new URL('/stub-runtime/',location.href).href,persistence:{mode:'persistent',namespace:crypto.randomUUID(),documentId:'same-document'},startupTimeoutMs:5000,disposeTimeoutMs:phase==='unconfirmed'?10:3000,workerUrls:{document:new URL('/dist/workers/document.worker.js',location.href).href,resource:new URL('/dist/workers/resource.worker.js',location.href).href}});},phase);
 if(phase==='ready')await page.waitForFunction(()=>readyEditors.length===1);else await fontRequested;
 await page.evaluate(()=>changeUi({drawingToolbar:false}));
 if(phase==='unconfirmed'){
  await page.waitForFunction(()=>errors.some(error=>error.code==='DisposeCleanupUnconfirmed'));release();
  await page.evaluate(()=>changeUi({drawingToolbar:{position:'right'}}));await page.waitForTimeout(300);
  expect(documentWorkers).toHaveLength(1);expect(await page.evaluate(()=>readyEditors.length)).toBe(0);
  expect(await page.evaluate(()=>errors.every(error=>error.code==='DisposeCleanupUnconfirmed'))).toBe(true);
 }else{
  if(phase==='starting'){await page.waitForTimeout(100);expect(documentWorkers).toHaveLength(1);release();}
  await page.waitForFunction(expected=>errors.length>0||readyEditors.length===expected,phase==='ready'?2:1,{timeout:10000});
  expect(await page.evaluate(()=>errors)).toEqual([]);expect(await page.evaluate(()=>readyEditors.length)).toBe(phase==='ready'?2:1);
 }
 await page.evaluate(()=>unmount());await expect(page.locator('iframe')).toHaveCount(0);
});
