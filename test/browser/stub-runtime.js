/** Direct-runtime fixture for React/SDK lifetime and DOM interaction tests. */
export async function mountCanvas({container,emit,platform}) {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%';canvas.tabIndex=0;const host=document.createElement('div');host.className='drawmotive-canvas-host';host.append(canvas);container.append(host);
  const state={revision:'r0',health:'healthy',editingEnabled:true,busy:false,canUndo:false,canRedo:false,tool:'select'};
  const preferences={darkTheme:false,showGrid:true,snapToGrid:true};
  emit('ready',{state});
  return {async request(method,args){
    if(method==='getState')return state;
    if(method==='getSelection')return {revision:state.revision,token:{session:'selection',version:1},items:[],anchor:null};
    if(method==='getPreferences')return {...preferences};
    if(method==='setPreferences'){Object.assign(preferences,args);emit('preferencesChanged',{...preferences});}
    if(method==='setTool'){state.tool=args.tool;emit('stateChanged',{...state});}
    if(method==='replaceDocument'){await platform('storage.open');await platform('storage.read');}
    return null;
  },async dispose(){await globalThis.nativeCleanup?.();host.remove();}};
}
