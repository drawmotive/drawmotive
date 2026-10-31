import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEditor } from '../core.js';
import type { EditorCreateOptions, EditorInstance } from '../core.js';
import { EditorUi, type EditorUiProps } from './editor-ui.js';
import './styles.css';
export { EditorUi };
export type { EditorUiProps };
export type { EditorUiOptions, EditorUiAction, EditorRegionId, EditorButtonId } from './ui-options.js';
export interface EditorProps extends Omit<EditorCreateOptions,'container'> {
  className?: string; style?: CSSProperties; slots?: Readonly<Record<string,ReactNode>>; colorScheme?: 'light'|'dark';
  onReady?: (editor:EditorInstance)=>void; onError?: (error:unknown)=>void;
}

/** React owns the host; Blazor owns only its canvas and native inline-editing DOM. */
export function Editor({className,style,slots,colorScheme,onReady,onError,...options}:EditorProps) {
  const runtime=useRef<HTMLDivElement>(null),callbacks=useRef({onReady,onError});callbacks.current={onReady,onError};
  const releasing=useRef<Promise<void>>(Promise.resolve());
  const [editor,setEditor]=useState<EditorInstance|null>(null);
  useEffect(()=>{
    let disposed=false,instance:EditorInstance|undefined,stop:undefined|(()=>void);
    const controller=new AbortController(),abort=()=>controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    setEditor(null);
    // The persistent writer belongs to the old session until disposal settles.
    // React cleanup is synchronous, so carry its asynchronous release to setup.
    const previousRelease=releasing.current;
    const starting=previousRelease.then(async()=>{
      if(disposed)return;
      const next=await createEditor({...options,container:runtime.current!,signal:controller.signal});
      instance=next;if(disposed)return;
      stop=next.onDisposed(()=>setEditor(null));setEditor(next);callbacks.current.onReady?.(next);
    });
    void starting.catch(error=>{if(!disposed)callbacks.current.onError?.(error);});
    return()=>{
      disposed=true;controller.abort();options.signal?.removeEventListener('abort',abort);stop?.();
      releasing.current=previousRelease.then(()=>starting.catch((error:unknown)=>{
        if((error as {code?:string})?.code==='DisposeCleanupUnconfirmed')throw error;
      })).then(async()=>{if(instance)await instance.dispose();});
      void releasing.current.catch(error=>callbacks.current.onError?.(error));
    };
  },[options.assetBaseUrl,options.ui,options.persistence,options.workerFactory,options.workerUrls,options.signal,options.title,options.startupTimeoutMs,options.disposeTimeoutMs]);
  return <div className={className} style={{position:'relative',width:'100%',height:'100%',...style}}>
    <div ref={runtime} style={{position:'absolute',inset:0}} />
    {editor&&<EditorUi editor={editor} container={runtime.current!} slots={slots} colorScheme={colorScheme} onError={onError}/>}
  </div>;
}

/** Used by the full imperative entry; React hosts can render EditorUi directly. */
export function mountEditorUi({editor,container,...props}:EditorUiProps): {dispose():void} {
  if(!editor.ui.enabled)return {dispose(){}};
  const win=container.ownerDocument.defaultView!,previous=container.style.position;
  const changed=win.getComputedStyle(container).position==='static';if(changed)container.style.position='relative';
  const element=container.ownerDocument.createElement('div');element.style.cssText='position:absolute;inset:0;pointer-events:none;';container.append(element);
  const root=createRoot(element);let disposed=false,unsubscribe:undefined|(()=>void);
  const dispose=()=>{if(disposed)return;disposed=true;unsubscribe?.();root.unmount();element.remove();if(changed&&container.style.position==='relative')container.style.position=previous;};
  root.render(<EditorUi editor={editor} container={container} {...props}/>);
  unsubscribe=editor.onDisposed(dispose);
  return {dispose};
}
