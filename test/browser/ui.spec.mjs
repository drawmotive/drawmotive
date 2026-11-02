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

test('context panels send one versioned generated-model batch and preserve the two-layer color icon',async({page})=>{
 await page.evaluate(()=>{instances.push(mount());instances[0].select();});
 await page.getByTestId('context-toolbar-fill-color').click();
 await expect(page.locator('.dm-stroke-fill > svg')).toHaveCount(2);
 const colors=page.getByRole('dialog',{name:'Border and Fill Color',exact:true});
 expect(await colors.evaluate(panel=>{const bounds=panel.getBoundingClientRect();return [...panel.querySelectorAll('button')].every(button=>{const rect=button.getBoundingClientRect();return rect.left>=bounds.left&&rect.right<=bounds.right&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom;});})).toBe(true);
 await page.getByTestId('panel-fill-color-secondaryfill').click();
 const call=await page.evaluate(()=>instances[0].calls.at(-1));expect(call.method).toBe('editScene');expect(call.args[0]).toMatchObject({revision:'r0',token:{version:2},changes:[{itemId:'Shape',path:['data','paintStyle','fillColor','colorClass'],value:'SecondaryFill'},{itemId:'Shape',path:['data','paintStyle','fillColor','colorValue'],value:null}]});
 await page.evaluate(()=>instances[0].setFailure({code:'StaleSelection',message:'Selection changed. Select again.'}));
 await page.getByTestId('panel-stroke-color-foreground').click();await expect(page.getByRole('alert')).toContainText('Selection changed');
 expect(await page.locator('body > .mantine-Popover-dropdown').count()).toBe(0);
});

for(const [location,side] of [['topLeft','bottom'],['topRight','bottom'],['bottomLeft','top'],['bottomRight','top'],['left','right'],['right','left'],['top','bottom'],['bottom','top']]) {
 test('toolbar tooltip faces inward at '+location,async({page})=>{
  await page.evaluate(location=>{const corner=['topLeft','topRight','bottomLeft','bottomRight'].includes(location);const instance=mount({tooltip:{delay:0},regions:{topLeft:{items:[]},topRight:{items:[]},bottomLeft:{items:[]},bottomRight:{items:[]},...(corner?{[location]:{items:['rectangle']}}:{})},drawingToolbar:corner?false:{position:location,tools:['rectangle']}});instance.root.style.marginTop='100px';instances.push(instance);},location);
  const button=page.getByRole('button',{name:'Rectangle',exact:true});await button.focus();
  const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();await expect(tip).toContainText('Rectangle');
  const id=await tip.getAttribute('id');await expect(button).toHaveAttribute('aria-describedby',id);
  const target=await button.boundingBox();
  await expect.poll(async()=>{const bounds=await tip.boundingBox();return side==='top'?bounds.y+bounds.height<=target.y:side==='bottom'?bounds.y>=target.y+target.height:side==='left'?bounds.x+bounds.width<=target.x:bounds.x>=target.x+target.width;}).toBe(true);
  expect(await tip.evaluate(el=>!!el.closest('.dm-editor-ui'))).toBe(true);
 });
}

test('Mantine tooltip and shortcut backgrounds contrast in both local color schemes',async({page})=>{
 await page.evaluate(()=>instances.push(mount({tooltip:{delay:0}})));
 const button=page.getByRole('button',{name:'Rectangle',exact:true});await button.focus();
 const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();
 const colors=()=>tip.evaluate(el=>{const badge=el.querySelector('kbd'),body=getComputedStyle(el),key=getComputedStyle(badge);return {background:body.backgroundColor,text:body.color,keyBackground:key.backgroundColor,keyText:key.color};});
 const light=await colors();expect(light.keyBackground).not.toBe(light.background);expect(light.text).not.toBe(light.background);expect(light.keyText).not.toBe(light.keyBackground);
 await page.evaluate(()=>instances[0].editor.setPreferences({darkTheme:true}));
 await expect(page.locator('.dm-editor-ui')).toHaveAttribute('data-mantine-color-scheme','dark');
 const dark=await colors();expect(dark.background).not.toBe(light.background);expect(dark.keyBackground).not.toBe(dark.background);expect(dark.text).not.toBe(dark.background);expect(dark.keyText).not.toBe(dark.keyBackground);
});

test('a light editor keeps its tooltip and shortcut colors inside a dark Mantine host',async({page})=>{
 await page.evaluate(()=>instances.push(mount({tooltip:{delay:0}})));
 await page.getByRole('button',{name:'Rectangle',exact:true}).focus();const tip=page.getByRole('tooltip');await expect(tip).toBeVisible();
 const colors=()=>tip.evaluate(el=>[el,el.querySelector('kbd')].map(node=>{const style=getComputedStyle(node);return [style.backgroundColor,style.color,style.borderColor];}));
 const light=await colors();await page.evaluate(()=>document.documentElement.dataset.mantineColorScheme='dark');
 await expect(page.locator('.dm-editor-ui')).toHaveAttribute('data-mantine-color-scheme','light');
 expect(await colors()).toEqual(light);
});

test('creation guidance follows the canvas pointer and updates under a stationary pointer',async({page})=>{
 await page.evaluate(()=>instances.push(mount()));
 await page.mouse.move(200,200);
 await page.evaluate(()=>instances[0].setState({tool:'rectangle',prompt:'Press to set the first corner.'}));
 const tip=page.getByTestId('creation-tooltip');await expect(tip).toBeVisible();await expect(tip).toContainText('first corner');
 const before=await tip.boundingBox();await page.mouse.move(300,250);
 await expect.poll(async()=>{const next=await tip.boundingBox();return next.x>before.x+50&&next.y>before.y+20;}).toBe(true);
 await page.evaluate(()=>instances[0].setState({busy:true,prompt:'Drag to the opposite corner, then release to finish.'}));
 await expect(tip).toBeVisible();await expect(tip).toContainText('opposite corner');
 expect(await page.evaluate(()=>document.elementFromPoint(300,250).tagName)).toBe('CANVAS');
 await page.mouse.move(15,15);await expect(tip).toBeHidden();
 await page.mouse.move(300,250);await expect(tip).toBeVisible();
 await page.evaluate(()=>instances[0].setState({busy:false,tool:'select',prompt:null}));await expect(tip).toBeHidden();
 await page.evaluate(()=>instances[0].setState({tool:'arrow',prompt:'Press to set the start point.'}));await expect(tip).toBeVisible();
 await page.evaluate(()=>instances[0].editor.dispose());await expect(tip).toHaveCount(0);
});

test('creation guidance respects tooltip visibility and instance ownership',async({page})=>{
 await page.evaluate(()=>{instances.push(mount({tooltip:false}));instances.push(mount());instances.forEach(instance=>instance.setState({tool:'text',prompt:'Click to place text.'}));});
 await page.mouse.move(200,200);await expect(page.getByTestId('creation-tooltip').filter({visible:true})).toHaveCount(0);
 await page.mouse.move(850,200);const tip=page.getByTestId('creation-tooltip').filter({visible:true});await expect(tip).toHaveCount(1);
 expect(await tip.evaluate(el=>instances[1].root.contains(el))).toBe(true);
 await page.evaluate(()=>instances[1].setState({editingEnabled:false}));await expect(tip).toHaveCount(0);
});

test('preserved host canvases do not become the creation tooltip target',async({page})=>{
 await page.evaluate(async()=>{
  const instance=mount();instance.view.dispose();
  const foreign=document.createElement('canvas');foreign.id='host-preview';foreign.style.cssText='position:absolute;left:400px;top:300px;width:100px;height:60px;z-index:20';instance.root.prepend(foreign);
  const {mountEditorUi}=await import('/dist/editor-ui.js');instance.view=mountEditorUi({editor:instance.editor,container:instance.root});instances.push(instance);
 });
 await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toBeVisible();
 await page.mouse.move(200,200);await page.evaluate(()=>instances[0].setState({tool:'rectangle',prompt:'Press to set the first corner.'}));
 const tip=page.getByTestId('creation-tooltip');await expect(tip).toBeVisible();
 await page.mouse.move(450,330);await expect(tip).toBeHidden();
});

test('captured drawing pointers hide guidance over host controls and restore it on canvas reentry',async({page})=>{
 await page.evaluate(()=>{
  const instance=mount();const canvas=instance.root.querySelector('.drawmotive-canvas-host canvas');canvas.addEventListener('pointerdown',event=>canvas.setPointerCapture(event.pointerId));instances.push(instance);
 });
 await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toBeVisible();
 await page.mouse.move(200,200);await page.evaluate(()=>instances[0].setState({tool:'rectangle',prompt:'Press to set the first corner.'}));
 const tip=page.getByTestId('creation-tooltip');await expect(tip).toBeVisible();await page.mouse.down();
 await page.evaluate(()=>instances[0].setState({busy:true,prompt:'Drag to the opposite corner, then release to finish.'}));
 await page.mouse.move(15,15);await expect(tip).toBeHidden();
 await page.mouse.move(300,250);await expect(tip).toBeVisible();await expect(tip).toContainText('opposite corner');
 await page.mouse.up();
});

test('stationary creation guidance is remeasured when its instruction grows near the viewport edge',async({page})=>{
 await page.evaluate(()=>{const instance=mount();instance.root.style.width='100vw';instances.push(instance);});
 await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toBeVisible();
 await page.mouse.move(1400,200);await page.evaluate(()=>instances[0].setState({tool:'rectangle',prompt:'Press to set the first corner.'}));
 const tip=page.getByTestId('creation-tooltip');await expect(tip).toBeVisible();
 const fits=async()=>{const box=await tip.boundingBox();return box.x>=0&&box.x+box.width<=1440;};
 await expect.poll(fits).toBe(true);
 await page.evaluate(()=>instances[0].setState({busy:true,prompt:'Drag to the opposite corner, then release to finish.'}));
 await expect(tip).toContainText('opposite corner');await expect.poll(fits).toBe(true);
});

test('an embedded editor does not clip creation guidance at its canvas edge',async({page})=>{
 await page.evaluate(()=>instances.push(mount()));await expect(page.getByRole('button',{name:'Rectangle',exact:true})).toBeVisible();
 await page.mouse.move(620,200);await page.evaluate(()=>instances[0].setState({tool:'rectangle',prompt:'Press to set the first corner.'}));
 const tip=page.getByTestId('creation-tooltip');await expect(tip).toBeVisible();
 await expect.poll(()=>tip.evaluate(el=>new Promise(resolve=>{const observer=new IntersectionObserver(entries=>{observer.disconnect();resolve(entries[0].intersectionRatio);});observer.observe(el);}))).toBeGreaterThan(.99);
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
 expect(await page.evaluate(()=>instances[0].calls.filter(call=>call.method==='editScene'))).toEqual([]);
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
 await page.getByLabel('Group theme color',{exact:true}).selectOption('AccentStroke');expect(await page.evaluate(()=>instances[0].calls.at(-1).args[0].changes)).toEqual([{itemId:'Group',op:'call',path:['setThemeColorRole'],arguments:['AccentStroke']}]);
 await page.getByRole('button',{name:'Title style',exact:true}).click();
 const title=page.getByRole('dialog',{name:'Title style',exact:true});await expect(title.getByLabel('Restore title theme style',{exact:true})).toBeVisible();
 await title.getByRole('button',{name:'Color',exact:true}).click();await page.getByTestId('panel-stroke-color-warningstroke').click();
 expect(await page.evaluate(()=>instances[0].calls.at(-1).args[0].changes)).toEqual([{itemId:'title',path:['fontStyle','color','colorClass'],value:'WarningStroke'},{itemId:'title',path:['fontStyle','color','colorValue'],value:null}]);
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
 await settings.click();
 const dialog=page.getByRole('dialog',{name:'Settings'});
 await expect(dialog).toBeVisible();
 // Escape belongs to the mounted panel, after its focus trap has received focus.
 await expect.poll(()=>dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(settings).toBeFocused();
});
