import {test,expect} from '@playwright/test';
test.use({launchOptions:{executablePath:process.env.DRAWMOTIVE_CHROMIUM_PATH}});
test.beforeEach(async({page})=>{
 await page.route('**/stub-runtime/embed.html*',route=>route.fulfill({contentType:'text/html',body:
  '<!doctype html><script type="module">'+
  'import {createRuntimeChannel} from "/src/bridge/runtime-channel.js";'+
  'const nonce=new URLSearchParams(location.hash.slice(1)).get("nonce");'+
  'const state={revision:"r0",health:"healthy",editingEnabled:true,busy:false,canUndo:false,canRedo:false,tool:"select"};'+
  'const preferences={darkTheme:false,showGrid:true,snapToGrid:true};'+
  'addEventListener("message",event=>{const message=event.data;if(message?.nonce!==nonce)return;const channel=createRuntimeChannel({port:event.ports[0],instanceId:message.instanceId,documentSessionId:message.documentSessionId});'+
  'for(const method of ["dispose","getPreferences","setPreferences","getSelection","getState","setTool"])channel.onRequest(method,args=>{if(method==="getState")return state;if(method==="getSelection")return {token:{session:"s",version:1},items:[],properties:{},anchor:null};if(method==="getPreferences")return {...preferences};if(method==="setPreferences"){Object.assign(preferences,args);channel.emit("preferencesChanged",{...preferences});}if(method==="setTool"){state.tool=args.tool;channel.emit("stateChanged",{...state});}return null;});channel.emit("ready",{state});});'+
  'parent.postMessage({type:"drawmotive:hello",protocolVersion:3},"*");</script>'}));
 await page.goto('/test/browser/host.html');
 await page.addStyleTag({url:'/dist/editor-ui.css'});
});

test('full entry mounts styled, interactive React controls; core can stay UI-free',async({page})=>{
 await page.evaluate(async()=>{const {createEditor}=await import('/src/index.js');const container=document.createElement('div');container.className='editor';document.body.append(container);globalThis.editor=await createEditor({container,assetBaseUrl:new URL('/stub-runtime/',location.href)});});
 const tool=page.getByRole('button',{name:'Rectangle',exact:true});await expect(tool).toBeVisible();await expect(tool).toHaveCSS('pointer-events','auto');await tool.click();
 expect(await page.evaluate(async()=> (await editor.getState()).tool)).toBe('rectangle');
 await page.evaluate(()=>editor.dispose());await expect(page.locator('.dm-editor-ui')).toHaveCount(0);await expect(page.locator('iframe')).toHaveCount(0);
});
test('host preference changes update React appearance and the settings controls',async({page})=>{
 await page.evaluate(async()=>{const {createEditor}=await import('/src/index.js');const container=document.createElement('div');container.className='editor';document.body.append(container);globalThis.editor=await createEditor({container,assetBaseUrl:new URL('/stub-runtime/',location.href)});});
 await expect(page.locator('.dm-editor-ui')).toHaveAttribute('data-mantine-color-scheme','light');
 await page.evaluate(()=>editor.setPreferences({darkTheme:true,showGrid:false}));
 await expect(page.locator('.dm-editor-ui')).toHaveAttribute('data-mantine-color-scheme','dark');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Dark Theme',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'Show and Snap to Grid',exact:true})).not.toBeChecked();
 await page.evaluate(()=>editor.dispose());
});

test('aborting while the full UI chunk loads rejects startup and releases the ready core',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/dist/editor-ui.js',async route=>{await gate;await route.continue();});
 const chunk=page.waitForRequest('**/dist/editor-ui.js');
 await page.evaluate(async()=>{const {createEditor}=await import('/src/index.js');const container=document.createElement('div');container.className='editor';document.body.append(container);globalThis.controller=new AbortController();globalThis.outcome='pending';void createEditor({container,assetBaseUrl:new URL('/stub-runtime/',location.href),signal:controller.signal,disposeTimeoutMs:1000}).then(()=>outcome='resolved',error=>outcome=error.name);});
 await chunk;await page.evaluate(()=>controller.abort());release();
 await expect.poll(()=>page.evaluate(()=>outcome),{timeout:5000}).toBe('AbortError');await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('.dm-editor-ui')).toHaveCount(0);
});
