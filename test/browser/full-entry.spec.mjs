import {test,expect} from '@playwright/test';
test.use({launchOptions:{executablePath:process.env.DRAWMOTIVE_CHROMIUM_PATH}});
test.beforeEach(async({page})=>{
 await page.route('**/stub-runtime/js/editor-canvas.js',route=>route.fulfill({contentType:'text/javascript',body:'export {mountCanvas} from "/test/browser/stub-runtime.js";'}));
 await page.goto('/test/browser/host.html');
 await page.addStyleTag({url:'/dist/editor-ui.css'});
});

test('full entry mounts styled, interactive React controls; core can stay UI-free',async({page})=>{
 await page.evaluate(async()=>{const {createEditor}=await import('/src/index.js');const container=document.createElement('div');container.className='editor';document.body.append(container);globalThis.editor=await createEditor({container,assetBaseUrl:new URL('/stub-runtime/',location.href)});});
 const tool=page.getByRole('button',{name:'Rectangle',exact:true});await expect(tool).toBeVisible();await expect(tool).toHaveCSS('pointer-events','auto');await tool.click();
 expect(await page.evaluate(async()=> (await editor.getState()).tool)).toBe('rectangle');
 await page.evaluate(()=>editor.dispose());await expect(page.locator('.dm-editor-ui')).toHaveCount(0);await expect(page.locator('.dm-canvas-root')).toHaveCount(0);
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
 await expect.poll(()=>page.evaluate(()=>outcome),{timeout:5000}).toBe('AbortError');await expect(page.locator('.dm-canvas-root')).toHaveCount(0);await expect(page.locator('.dm-editor-ui')).toHaveCount(0);
});

for (const ui of [false, { enabled: false }]) test(`full entry retains Mantine hotkeys with ui=${JSON.stringify(ui)}`, async ({ page }) => {
 await page.evaluate(async ui => {
  const { createEditor } = await import('/src/index.js');
  const container = document.createElement('div'); container.className = 'editor'; document.body.append(container);
  globalThis.editor = await createEditor({ container, ui, assetBaseUrl: new URL('/stub-runtime/', location.href) });
 }, ui);
 await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toHaveCount(0);
 await page.locator('.drawmotive-canvas-host canvas').press('r');
 await expect.poll(() => page.evaluate(async () => (await editor.getState()).tool), { timeout: 5000 }).toBe('rectangle');
 await page.evaluate(() => editor.dispose());
});
