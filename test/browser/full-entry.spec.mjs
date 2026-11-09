import { test, expect } from '@playwright/test';
test.use({ launchOptions: { executablePath: process.env.DRAWMOTIVE_CHROMIUM_PATH } });
test('public entries relay the raw deployment key and immutable native license status',async({page})=>{
 await page.route('**/stub-runtime/js/editor-canvas.js',route=>route.fulfill({contentType:'text/javascript',body:
  'import {mountCanvas as mount} from "/test/browser/stub-runtime.js";export async function mountCanvas(context){globalThis.startupKey=context.options.licenseKey;const native=await mount(context);return {...native,request(method,args){if(method==="getLicenseStatus")return {state:"free",reason:"invalid"};return native.request(method,args);}};}'}));
 await page.goto('/test/browser/host.html');
 const results=await page.evaluate(async()=>{
  const results=[];
  for(const entry of ['/src/index.js','/src/core.js']) {
   const {createEditor}=await import(entry);const container=document.body.appendChild(document.createElement('div'));
   const editor=await createEditor({container,assetBaseUrl:'/stub-runtime/',licenseKey:'  opaque.deployment.key  '});
   const status=await editor.getLicenseStatus();
   results.push({key:startupKey,status,frozen:Object.isFrozen(status),revision:(await editor.getState()).revision});
   await editor.dispose();
   try {await editor.getLicenseStatus();}catch(error){results.at(-1).disposed=error.code;}
   container.remove();
  }
  return results;
 });
 expect(results).toEqual(Array(2).fill({key:'  opaque.deployment.key  ',status:{state:'free',reason:'invalid'},frozen:true,revision:'r0',disposed:'EditorDisposed'}));
});
test('public default entry mounts only a canvas without fetching private UI assets', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.route('**/stub-runtime/js/editor-canvas.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export {mountCanvas} from "/test/browser/stub-runtime.js";' }));
  await page.goto('/test/browser/host.html');
  const result = await page.evaluate(async () => {
    const { createEditor } = await import('/src/index.js');
    const container = document.createElement('div'); container.className = 'editor'; document.body.append(container);
    const editor = await createEditor({ container, assetBaseUrl: '/stub-runtime/', textEditing: 'external' });
    await editor.setTool('rectangle');
    const result = { textEditing: editor.textEditing, tool: (await editor.getState()).tool, canvases: container.querySelectorAll('canvas').length,
      buttons: container.querySelectorAll('button').length, chrome: container.querySelectorAll('.dm-editor-ui').length,
      ui: editor.ui, invokeAction: typeof editor.invokeAction };
    await editor.dispose(); return { ...result, remaining: container.childElementCount };
  });
  expect(result).toEqual({ textEditing: 'external', tool: 'rectangle', canvases: 1, buttons: 0, chrome: 0, ui: undefined, invokeAction: 'undefined', remaining: 0 });
  expect(requests.some(url => /editor-ui|mantine|react[.]js/.test(url))).toBe(false);
});
test('host example ignores IME Escape and handles rejected canvas cancellation', async ({ page }) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/generated/editor/js/editor-canvas.js',route=>route.fulfill({contentType:'text/javascript',body:
    'import {mountCanvas as mount} from "/test/browser/stub-runtime.js"; export async function mountCanvas(options){const native=await mount(options);globalThis.hostCalls=[];return {...native,request(method,args){hostCalls.push(method);if(method==="cancelInteraction")throw new Error("Cancellation rejected");return native.request(method,args);}};}'}));
  await page.goto('/examples/browser/');await expect(page.locator('#status')).toHaveText('Ready to edit');
  await page.evaluate(()=>{
    const canvas=document.querySelector('canvas');
    for(const options of [{isComposing:true},{keyCode:229}])canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,...options}));
    const foreign=document.createElement('input');document.querySelector('#editor').append(foreign);foreign.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  });
  expect(await page.evaluate(()=>hostCalls.includes('cancelInteraction'))).toBe(false);
  await page.locator('canvas').press('Escape');await expect(page.locator('#status')).toHaveText('Cancellation rejected');
  expect(errors).toEqual([]);
});
