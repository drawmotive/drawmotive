import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
test.use({ launchOptions: { executablePath: process.env.DRAWMOTIVE_CHROMIUM_PATH } });
test.beforeEach(async({page})=>{await page.goto('/test/browser/ui-harness.html');await page.waitForFunction(()=>typeof mount==='function',undefined,{timeout:5000});});

test('all four corners and drawing tools are configurable without hiding inline editing',async({page})=>{
 await page.evaluate(()=>instances.push(mount({regions:{topLeft:{items:['undo']},topRight:{items:['host.save']},bottomLeft:{items:['sketchyMode']},bottomRight:{items:['zoomIn']}},actions:[{id:'host.save',label:'Save',onInvoke(){}}],drawingToolbar:{position:'bottom',tools:['diamond']}})));
 for(const id of ['topLeft','topRight','bottomLeft','bottomRight']) await expect(page.locator('[data-region="'+id+'"]')).toBeVisible();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 expect(await page.evaluate(()=>instances[0].calls.at(-1))).toEqual({method:'invokeAction',args:['host.save']});
 await page.getByRole('button',{name:'Diamond',exact:true}).click();
 expect(await page.evaluate(()=>instances[0].calls.at(-1))).toEqual({method:'setTool',args:['diamond']});
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
 await page.evaluate(()=>instances[0].setState({canUndo:true}));await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
 await page.evaluate(()=>instances.push(mount(false)));expect(await page.locator('.dm-editor-ui').count()).toBe(1);
});

test('context panels send versioned semantic intents and preserve the two-layer color icon',async({page})=>{
 await page.evaluate(()=>{instances.push(mount());instances[0].select();});
 await page.getByTestId('context-toolbar-fill-color').click();
 await expect(page.locator('.dm-stroke-fill > svg')).toHaveCount(2);
 const colors=page.getByRole('dialog',{name:'Border and Fill Color',exact:true});
 expect(await colors.evaluate(panel=>{const bounds=panel.getBoundingClientRect();return [...panel.querySelectorAll('button')].every(button=>{const rect=button.getBoundingClientRect();return rect.left>=bounds.left&&rect.right<=bounds.right&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom;});})).toBe(true);
 await page.getByTestId('panel-fill-color-secondaryfill').click();
 const call=await page.evaluate(()=>instances[0].calls.at(-1));expect(call.method).toBe('setProperty');expect(call.args[0].version).toBe(2);expect(call.args[1]).toEqual({command:'FillColor',color:'SecondaryFill'});
 await page.evaluate(()=>instances[0].setFailure({code:'StaleSelection',message:'Selection changed. Select again.'}));
 await page.getByTestId('panel-stroke-color-foreground').click();await expect(page.getByRole('alert')).toContainText('Selection changed');
 expect(await page.locator('body > .mantine-Popover-dropdown').count()).toBe(0);
});

test('tooltip arrow is separate, focus-accessible and confined to the instance',async({page})=>{
 await page.evaluate(()=>instances.push(mount({tooltip:{delay:0,position:'right'}})));
 await page.getByRole('button',{name:'Rectangle',exact:true}).focus();
 const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();await expect(tip.locator('.dm-tooltip-arrow')).toHaveCount(1);await expect(tip.locator('.dm-tooltip-content')).toContainText('Rectangle');
 await expect(tip).toHaveAttribute('data-position','right');
 await expect(tip.locator('.dm-tooltip-arrow')).toHaveCSS('border-left-width','0px');
 await expect(tip.locator('.dm-tooltip-arrow')).toHaveCSS('border-right-width','5px');
 expect(await tip.evaluate(el=>{const arrow=el.querySelector('.dm-tooltip-arrow').getBoundingClientRect(),body=el.querySelector('.dm-tooltip-content').getBoundingClientRect();return body.left-arrow.right;})).toBeGreaterThanOrEqual(2);
 const id=await tip.getAttribute('id');await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toHaveAttribute('aria-describedby',id);
 expect(await tip.evaluate(el=>!!el.closest('.dm-editor-ui'))).toBe(true);
});


test('property and viewport refreshes retain an open panel, while a new selection closes it',async({page})=>{
 await page.evaluate(()=>{instances.push(mount());instances[0].select();});
 await page.getByTestId('context-toolbar-fill-color').click();await expect(page.getByRole('dialog',{name:'Border and Fill Color'})).toBeVisible();
 const toolbar=page.getByTestId('context-toolbar'),before=await toolbar.evaluate(el=>el.style.left);
 await page.evaluate(()=>instances[0].refreshSelection());await expect(toolbar).not.toHaveCSS('left',before);await expect(page.getByTestId('context-toolbar-fill-color')).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('dialog',{name:'Border and Fill Color'})).toBeVisible();
 await page.evaluate(()=>instances[0].select('Line'));await expect(page.getByRole('dialog',{name:'Border and Fill Color'})).toHaveCount(0);
});
test('a closing palette cannot apply to the next selection during a transition',async({page})=>{
 await page.evaluate(()=>{instances.push(mount());instances[0].select('Shape',{id:'first'});});
 await page.getByTestId('context-toolbar-fill-color').click();
 const target=page.getByTestId('panel-fill-color-secondaryfill');await expect(target).toBeVisible();
 await page.waitForTimeout(170);const bounds=await target.boundingBox();
 await page.evaluate(()=>instances[0].select('Shape',{id:'second'}));
 await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 expect(await page.evaluate(()=>instances[0].calls.filter(call=>call.method==='setProperty'))).toEqual([]);
});
test('selection refreshes and an old idle notification cannot show tools over a new gesture',async({page})=>{
 await page.evaluate(()=>{instances.push(mount());instances[0].select();});
 const toolbar=page.getByTestId('context-toolbar');await expect(toolbar).toBeVisible();
 await page.evaluate(()=>instances[0].setState({busy:true}));await expect(toolbar).toHaveCount(0);
 await page.evaluate(()=>instances[0].refreshSelection());await expect(toolbar).toHaveCount(0);
 await page.evaluate(()=>{instances[0].setState({busy:false});instances[0].setState({busy:true});instances[0].refreshSelection();});
 await expect(toolbar).toHaveCount(0);
 await page.evaluate(()=>instances[0].setState({busy:false}));await expect(toolbar).toBeVisible();
});
test('group controls stay inline and the title toolbar keeps its nested color panel',async({page})=>{
 await page.evaluate(()=>{instances.push(mount());instances[0].select('Group');});
 await expect(page.getByLabel('Group theme color',{exact:true})).toBeVisible();
 await page.getByLabel('Group theme color',{exact:true}).selectOption('AccentStroke');expect(await page.evaluate(()=>instances[0].calls.at(-1).args[1])).toEqual({command:'GroupColorRole',color:'AccentStroke'});
 await page.getByRole('button',{name:'Title style',exact:true}).click();
 const title=page.getByRole('dialog',{name:'Title style',exact:true});await expect(title.getByLabel('Restore title theme style',{exact:true})).toBeVisible();
 await title.getByRole('button',{name:'Color',exact:true}).click();await page.getByTestId('panel-stroke-color-warningstroke').click();
 expect(await page.evaluate(()=>instances[0].calls.at(-1).args[1])).toEqual({command:'StrokeColor',color:'WarningStroke',targetItemId:'title'});
 await expect(title).toBeVisible();
});
test('a toolbar mounted after a busy document boundary is positioned at the retained selection',async({page})=>{
 await page.evaluate(()=>instances.push(mount()));
 await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toBeVisible();
 await page.evaluate(()=>{instances[0].setState({busy:true});instances[0].select();});
 await expect(page.getByTestId('context-toolbar')).toHaveCount(0);
 await page.evaluate(()=>instances[0].setState({busy:false}));
 const toolbar=page.getByTestId('context-toolbar');await expect(toolbar).toBeVisible();
 const position=await toolbar.evaluate(element=>({left:parseFloat(element.style.left),top:parseFloat(element.style.top)}));
 expect(position.left).toBeGreaterThan(20);expect(position.top).toBeGreaterThan(20);
});

test('StrictMode cleanup and newer events own selection and preference initialization',async({page})=>{
 const fixture=await build({stdin:{contents:
  'import {createElement,StrictMode} from "react";import {createRoot} from "react-dom/client";'+
  'import {EditorUi} from "./src/react/editor-ui.tsx";'+
  'globalThis.strictMount=(editor,container)=>{const slot=document.createElement("div");container.append(slot);const root=createRoot(slot);root.render(createElement(StrictMode,null,createElement(EditorUi,{editor,container})));return root;};',
  resolveDir:fileURLToPath(new URL('../..',import.meta.url)),sourcefile:'strict-ui-fixture.js'},write:false,bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic'});
 await page.route('**/strict-ui-fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture.outputFiles[0].text}));
 await page.evaluate(async()=>{
  const instance=mount();instance.view.dispose();globalThis.strictInstance=instance;
  const selection=await instance.editor.getSelection(),preferences=await instance.editor.getPreferences();globalThis.initializers=[];
  instance.editor.getSelection=()=>new Promise(resolve=>initializers.push({kind:'selection',resolve:()=>resolve(selection)}));
  instance.editor.getPreferences=()=>new Promise(resolve=>initializers.push({kind:'preferences',resolve:()=>resolve(preferences)}));
  await import('/strict-ui-fixture.js');globalThis.strictRoot=strictMount(instance.editor,instance.root);
 });
 await page.waitForFunction(()=>initializers.length===4);
 await page.evaluate(async()=>{strictInstance.select();await strictInstance.editor.setPreferences({darkTheme:true});});
 await expect(page.getByTestId('context-toolbar')).toHaveCount(1);
 await expect(page.locator('.dm-editor-ui')).toHaveAttribute('data-mantine-color-scheme','dark');
 await page.evaluate(()=>{initializers[0].resolve();initializers[1].resolve();});
 await page.waitForTimeout(100);
 await expect(page.getByTestId('context-toolbar')).toHaveCount(1,{timeout:1000});
 await expect(page.locator('.dm-editor-ui')).toHaveAttribute('data-mantine-color-scheme','dark',{timeout:1000});
 await page.evaluate(()=>{initializers[2].resolve();initializers[3].resolve();});
 await page.waitForTimeout(100);
 await expect(page.getByTestId('context-toolbar')).toHaveCount(1,{timeout:1000});
 await expect(page.locator('.dm-editor-ui')).toHaveAttribute('data-mantine-color-scheme','dark',{timeout:1000});
 await page.evaluate(()=>strictRoot.unmount());
 expect(await page.evaluate(()=>Object.values(strictInstance.listeners).every(listeners=>listeners.size===0))).toBe(true);
});

test('reusing EditorUi for the next document resets closed state and configuration',async({page})=>{
 const fixture=await build({stdin:{contents:
 'import {createElement} from "react";import {createRoot} from "react-dom/client";import {EditorUi} from "./src/react/editor-ui.tsx";'+
 'const root=createRoot(document.body.appendChild(document.createElement("div")));globalThis.showEditor=(editor,container)=>root.render(createElement(EditorUi,{editor,container}));',
 resolveDir:fileURLToPath(new URL('../..',import.meta.url)),sourcefile:'reuse.js'},write:false,outfile:'reuse.js',bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic'});
 await page.route('**/reuse.js',route=>route.fulfill({contentType:'text/javascript',body:fixture.outputFiles.find(file=>file.path.endsWith('.js')).text}));
 await page.evaluate(async()=>{await import('/reuse.js');const first=mount();first.view.dispose();globalThis.first=first;showEditor(first.editor,first.root);});
 await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toBeVisible();await page.evaluate(()=>first.editor.dispose());await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const next=mount({buttons:{rectangle:false}});next.view.dispose();showEditor(next.editor,next.root);});await expect(page.getByRole('button',{name:'Ellipse',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toHaveCount(0);
});

test('canvas pointer dismissal keeps native keyboard focus while Escape restores the panel trigger',async({page})=>{
 await page.evaluate(()=>{const current=mount();current.root.classList.add('drawmotive-canvas-host');const canvas=current.root.querySelector('canvas');canvas.tabIndex=0;canvas.addEventListener('pointerdown',()=>canvas.focus());instances.push(current);});
 const settings=page.getByRole('button',{name:'Settings',exact:true});await settings.click();await expect(page.getByRole('dialog',{name:'Settings'})).toBeVisible();await page.locator('canvas').click({position:{x:400,y:300}});
 await expect(page.getByRole('dialog',{name:'Settings'})).toHaveCount(0);
 // Mantine schedules focus return after dismissal; observe that completed handoff.
 await page.waitForTimeout(100);await expect(page.locator('canvas')).toBeFocused();
 await settings.click();await page.keyboard.press('Escape');await expect(settings).toBeFocused();
});
