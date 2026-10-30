import {test,expect} from '@playwright/test';
async function create(page,options={}){
 await page.goto('/test/browser/host.html');
 await page.evaluate(async options=>{const {createEditor}=await import('/src/core.js');const container=document.body.appendChild(document.createElement('div'));container.className='editor';globalThis.editor=await createEditor({container,assetBaseUrl:'/generated/editor/',ui:false,...options});},options);
 await expect(page.locator('.dm-canvas-root canvas')).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);
}
test('direct semantic import/export rejects invalid input without changing the document',async({page})=>{
 await create(page);const result=await page.evaluate(async()=>{await editor.replaceTextGraph('A -> B');const before=await editor.exportSnapshot({formats:['raw']});let code;try{await editor.replaceDocument('invalid');}catch(error){code=error.code;}const after=await editor.exportSnapshot({formats:['raw']});await editor.dispose();return {before,after,code};});
 expect(result.code).toBeTruthy();expect(result.after).toEqual(result.before);await expect(page.locator('canvas')).toHaveCount(0);
});
test('a page rejects concurrent mounts and reopening starts with fresh undo history',async({page})=>{
 await create(page);const result=await page.evaluate(async()=>{const {createEditor}=await import('/src/core.js');await editor.setSketchyMode(true);const state=await editor.getState();let code;try{await createEditor({container:document.body,assetBaseUrl:'/generated/editor/'});}catch(error){code=error.code;}await editor.dispose();editor=await createEditor({container:document.querySelector('.editor'),assetBaseUrl:'/generated/editor/',ui:false});return {code,hadUndo:state.canUndo,next:await editor.getState()};});
 expect(result.code).toBe('EditorAlreadyMounted');expect(result.hadUndo).toBe(true);expect(result.next.canUndo).toBe(false);expect(result.next.sketchyMode).toBe(false);await page.evaluate(()=>editor.dispose());
});
test('persistent close and reopen preserves bytes in a fresh document scope',async({page})=>{
 const persistence={mode:'persistent',namespace:'contract-'+crypto.randomUUID(),documentId:'one'};await create(page,{persistence});
 const result=await page.evaluate(async persistence=>{const {createEditor}=await import('/src/core.js');await editor.replaceTextGraph('One -> Two');const before=await editor.exportSnapshot({formats:['raw']});await editor.dispose();editor=await createEditor({container:document.querySelector('.editor'),assetBaseUrl:'/generated/editor/',ui:false,persistence});const after=await editor.exportSnapshot({formats:['raw']});const state=await editor.getState();await editor.dispose();return {before,after,canUndo:state.canUndo};},persistence);
 expect(result.after.raw).toBe(result.before.raw);expect(result.canUndo).toBe(false);
});
