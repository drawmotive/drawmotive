import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import type { EditorInstance, EditorPreferences, EditorPropertyChange, EditorSelectionSnapshot, EditorState } from '../core.js';
import type { EditorRegionItem } from './ui-options.js';
import { CONTEXT_PANEL_IDS, contextTools, mapCanvasBounds, placeFloating, selectionSubjects } from './ui-model.js';
import { colorCss, LABELS, PanelButton, Separator, SHORTCUTS, ToolButton, UiContext, uniform } from './controls.js';
import { EndpointIcon, Icon, PaletteIcon } from './icons.js';
import { AlignPanel, AttachmentPanel, Colors, EndpointPanel, GroupPanel, MorePanel, RoutingPanel, SettingsPanel, StrokePanel, TitlePanel } from './panels.js';

export interface EditorUiProps {
  editor: EditorInstance;
  /** The container owning this editor's iframe. Portals remain inside this element. */
  container: HTMLElement;
  slots?: Readonly<Record<string,ReactNode>>;
  colorScheme?: 'light'|'dark';
  className?: string;
  style?: CSSProperties;
  onError?: (error: unknown) => void;
}
const idle:EditorState={revision:null,health:'healthy',editingEnabled:false,busy:true,canUndo:false,canRedo:false};

/** Local UI observes immutable snapshots; every edit uses the engine's semantic API. */
export function EditorUi(props:EditorUiProps) {
  return <EditorUiSession key={props.editor.instanceId+':'+props.editor.documentSessionId} {...props}/>;
}
function EditorUiSession({editor,container,slots={},colorScheme,className='',style,onError}:EditorUiProps) {
  const [ui,setUi]=useState(editor.ui),[state,setState]=useState<EditorState>(idle),[selection,setSelection]=useState<EditorSelectionSnapshot|null>(null);
  const [preferences,setPreferences]=useState<EditorPreferences>({}),[panel,setPanel]=useState<string|null>(null),[error,setError]=useState<unknown>(null);
  const [pending,setPending]=useState<ReadonlySet<string>>(new Set()),[closed,setClosed]=useState(editor.lifecycle!=='ready');
  const alive=useRef(false),pendingRef=useRef(new Set<string>()),overlay=useRef<HTMLDivElement>(null),toolbar=useRef<HTMLFieldSetElement>(null);
  const selectionRef=useRef<EditorSelectionSnapshot|null>(null);
  const [position,setPosition]=useState({left:0,top:0});
  const errorCallback=useRef(onError);errorCallback.current=onError;
  const report=useCallback((reason:unknown)=>{if(!alive.current)return;setError(reason);try{errorCallback.current?.(reason);}catch{/* Host errors must not reject an event callback. */}},[]);
  useEffect(()=>{
    if(closed||!ui.enabled)return;
    alive.current=true;let cancelled=false,selectionEvents=0,preferenceEvents=0;
    const stops=[editor.onStateChanged(setState),editor.onUiChanged(setUi),editor.onEvent('selectionChanged',next=>{
      const previous=selectionRef.current;selectionEvents++;selectionRef.current=next;setSelection(next);
      if(previous&&(previous.token.session!==next.token.session||previous.token.version!==next.token.version))setPanel(current=>current==='settings'?current:null);
    }),editor.onPreferencesChanged(next=>{preferenceEvents++;setPreferences(next);}),editor.onDisposed(()=>setClosed(true))];
    // Each effect owns its responses. StrictMode can start a new effect while an
    // earlier get is still pending; replayed/new events also supersede initial reads.
    const reject=(reason:unknown)=>{if(!cancelled)report(reason);};
    void editor.getSelection().then(next=>{if(!cancelled&&selectionEvents===0){selectionRef.current=next;setSelection(next);}},reject);
    void editor.getPreferences().then(next=>{if(!cancelled&&preferenceEvents===0)setPreferences(next);},reject);
    return ()=>{cancelled=true;alive.current=false;stops.forEach(stop=>stop());};
  },[editor,closed,report,ui.enabled]);

  const run=useCallback(async(action:()=>Promise<unknown>,key='document'):Promise<boolean>=>{
    if(!alive.current||pendingRef.current.has(key))return false;
    pendingRef.current.add(key);setPending(new Set(pendingRef.current));setError(null);
    try {await action();return true;}
    catch(reason){
      report(reason);
      // Unknown completion is observed, never retried as another edit.
      const unknown=reason as {code?:string;completion?:Promise<{error?:unknown}>};
      if(unknown?.code==='RequestTimeoutUnknown'&&unknown.completion){
        try{const completion=await unknown.completion;if(completion.error){report(completion.error);return false;}if(alive.current)setError(null);return true;}
        catch(late){report(late);}
      }
      return false;
    } finally {pendingRef.current.delete(key);if(alive.current)setPending(new Set(pendingRef.current));}
  },[report]);
  const property=useCallback((change:EditorPropertyChange)=>selection?run(()=>editor.setProperty(selection.token,change)):Promise.resolve(false),[editor,selection,run]);
  const changePreferences=async(value:EditorPreferences)=>{await run(()=>editor.setPreferences(value),'preferences');};
  const subjects=selection?selectionSubjects(selection.items):[], item=subjects[0];
  const contextIds=contextTools(subjects,ui.contextToolbar).filter(id=>id!=='editText'||ui.textEditing!=='disabled');
  const editingBlocked=!state.editingEnabled||state.health!=='healthy'||state.busy||pending.has('document');

  useLayoutEffect(()=>{
    if(closed||!overlay.current)return;
    const root=overlay.current,frame=container.querySelector('iframe'),win=container.ownerDocument.defaultView!;
    function measure(){
      if(!root||!frame||!toolbar.current||!selection?.anchor)return;
      const mapped=mapCanvasBounds(selection.anchor,frame.getBoundingClientRect(),{width:frame.clientWidth,height:frame.clientHeight},root.getBoundingClientRect(),{width:root.clientWidth,height:root.clientHeight});
      const next=placeFloating(mapped,{width:toolbar.current.offsetWidth,height:toolbar.current.offsetHeight},{width:root.clientWidth,height:root.clientHeight});
      setPosition(old=>old.left===next.left&&old.top===next.top?old:next);
    }
    measure();const observer=new win.ResizeObserver(measure);observer.observe(root);if(frame)observer.observe(frame);if(toolbar.current)observer.observe(toolbar.current);
    win.addEventListener('scroll',measure,true);return()=>{observer.disconnect();win.removeEventListener('scroll',measure,true);};
  },[container,selection,closed,contextIds.join(',')]);

  if(closed||!ui.enabled)return null;
  const context={editor,ui,state:{...state,busy:state.busy||pending.has('document')},selection,panel,setPanel,run,property};
  function builtin(id:string) {
    if(!ui.buttons[id as keyof typeof ui.buttons])return null;
    const disabled=(id==='undo'?!state.canUndo||editingBlocked:id==='redo'?!state.canRedo||editingBlocked:
      ['arrow','rectangle','ellipse','diamond','text','sketchyMode'].includes(id)?editingBlocked:false);
    if(id==='settings')return <PanelButton key={id} id="settings" button={<ToolButton icon={id}/>}> <SettingsPanel preferences={preferences} onChange={changePreferences}/></PanelButton>;
    if(id==='help')return <PanelButton key={id} id="help" button={<ToolButton icon={id}/>}> <div className="dm-help"><strong>Keyboard shortcuts</strong>{Object.entries(SHORTCUTS).map(([name,key])=><div key={name}>{LABELS[name]}<kbd>{key}</kbd></div>)}</div></PanelButton>;
    const invoke=()=>{
      if(id==='undo'||id==='redo')return editor[id]();
      if(id==='sketchyMode')return editor.setSketchyMode(!state.sketchyMode);
      if(id==='zoomIn'||id==='zoomOut'||id==='resetZoom')return editor.zoom(id==='zoomIn'?'in':id==='zoomOut'?'out':'reset');
      return editor.setTool(id as 'arrow'|'rectangle'|'ellipse'|'diamond'|'text');
    };
    return <ToolButton key={id} icon={id} shortcut={SHORTCUTS[id]} disabled={disabled} selected={id==='sketchyMode'?state.sketchyMode:state.tool===id}
      onClick={()=>void run(invoke,['zoomIn','zoomOut','resetZoom'].includes(id)?'viewport':'document')}>
      {id==='resetZoom'?<span className="dm-zoom">{Math.round((state.zoom??1)*100)}%</span>:undefined}
    </ToolButton>;
  }
  function regionItem(id:EditorRegionItem) {
    if(id.startsWith('slot.'))return slots[id.slice(5)]==null?null:<span key={id} className="dm-slot">{slots[id.slice(5)]}</span>;
    if(!id.startsWith('host.'))return builtin(id);
    const action=ui.actions.find(action=>action.id===id);
    if(!action?.visible)return null;
    return <ToolButton key={id} aria-label={action.label} disabled={!action.enabled||pending.has(id)} className="dm-host-action" onClick={()=>void run(()=>editor.invokeAction(id),id)}>
      {action.icon&&<Icon name={action.icon}/>}<span>{pending.has(id)?action.label+'…':action.label}</span>
    </ToolButton>;
  }
  async function copy(){if(selection)await editor.copyToClipboard(selection.token);}
  function contextButton(id:string){
    if(id==='groupTheme')return <GroupPanel key={id} inline/>;
    const p=selection!.properties;
    const testId='context-toolbar-'+({strokeFillColor:'fill-color',strokeColor:'stroke-color',strokeStyle:'stroke-style',lineStartStyle:'line-start-style',lineEndStyle:'line-end-style',lineRouting:'line-connector-type',lineAttachment:'line-attachment',moreOptions:'more-options',groupTitleStyle:'group-title-style'}[id]??id.replace(/([a-z])([A-Z])/g,'$1-$2').toLowerCase());
    const selected=id==='bold'?uniform(p.bold):id==='italic'?uniform(p.italic):id==='cornerRadius'?(uniform(p.cornerRadius)??0)>0:id.startsWith('textSize')?uniform(p.textSize)===id.slice(8):undefined;
    const direct=()=>{
      if(id==='editText')return run(()=>editor.beginTextEditing(item?.id));
      if(id.startsWith('textSize'))return property({command:'TextSize',fontSize:id.slice(8)});
      return property({command:({bold:'ToggleBold',italic:'ToggleItalic',cornerRadius:'ToggleCornerRadius',swapLineEndpoints:'SwapLineEndpointStyles'} as const)[id as 'bold'|'italic'|'cornerRadius'|'swapLineEndpoints']});
    };
    const content=id==='strokeFillColor'?<span className="dm-stroke-fill" data-transparent={uniform(p.fillColor)?.role==='Transparent'?'':undefined}>
      <PaletteIcon fill={colorCss(uniform(p.fillColor)?.role,uniform(p.fillColor)?.argb)} style={{color:colorCss(uniform(p.fillColor)?.role==='Transparent'?'SecondaryStroke':uniform(p.fillColor)?.role)}}/>
      <PaletteIcon style={{color:colorCss(uniform(p.strokeColor)?.role,uniform(p.strokeColor)?.argb)}}/>
    </span>:id==='lineStartStyle'||id==='lineEndStyle'?<EndpointIcon value={uniform(id==='lineStartStyle'?p.lineStartStyle:p.lineEndStyle)??0} start={id==='lineStartStyle'}/>:undefined;
    const isPanel=CONTEXT_PANEL_IDS.includes(id);
    const button=<ToolButton icon={id} data-testid={testId} selected={selected} shortcut={SHORTCUTS[id]} disabled={id==='swapLineEndpoints'&&p.lineStartStyle.state==='Uniform'&&p.lineEndStyle.state==='Uniform'&&uniform(p.lineStartStyle)===uniform(p.lineEndStyle)}
      onClick={isPanel?undefined:()=>void direct()}>{content}</ToolButton>;
    if(!isPanel)return <span key={id}>{button}</span>;
    const panels:Record<string,ReactNode>={strokeFillColor:<Colors fill/>,strokeColor:<Colors/>,strokeStyle:<StrokePanel/>,textAlign:<AlignPanel/>,lineStartStyle:<EndpointPanel start/>,lineEndStyle:<EndpointPanel start={false}/>,lineRouting:<RoutingPanel/>,lineAttachment:<AttachmentPanel/>,groupTheme:<GroupPanel/>,groupTitleStyle:<TitlePanel/>,moreOptions:<MorePanel copy={copy}/>};
    return <PanelButton key={id} id={id} button={button}>{panels[id]}</PanelButton>;
  }
  return <div ref={overlay} className={'dm-editor-ui '+className} style={style} data-editor-instance={editor.instanceId} data-mantine-color-scheme={colorScheme??(preferences.darkTheme?'dark':'light')}>
    <MantineProvider forceColorScheme={colorScheme??(preferences.darkTheme?'dark':'light')} cssVariablesSelector={'[data-editor-instance="'+editor.instanceId+'"]'} getRootElement={()=>overlay.current??undefined}>
      <UiContext.Provider value={context}>
        {Object.entries(ui.regions).map(([id,region])=>{const children=region.items.map(regionItem).filter(Boolean);return region.visible&&children.length>0?<div key={id} className={'dm-toolbar dm-corner dm-'+id} role="toolbar" aria-label={id+' toolbar'} data-region={id}>{children}</div>:null;})}
        {ui.drawingToolbar.visible&&ui.drawingToolbar.tools.some(id=>ui.buttons[id])&&<fieldset className={'dm-toolbar dm-drawing dm-'+ui.drawingToolbar.position} disabled={editingBlocked} aria-label="Drawing tools" data-testid="drawing-toolbar">{ui.drawingToolbar.tools.map(builtin)}</fieldset>}
        {selection&&selection.anchor&&contextIds.length>0&&!state.busy&&<fieldset ref={toolbar} className="dm-toolbar dm-context" disabled={editingBlocked} style={position} aria-label="Selection tools" data-testid="context-toolbar" data-item-id={item?.id}>
          {contextIds.map((id,index)=>{
            if(id.startsWith('textSize')&&contextIds[index-1]?.startsWith('textSize'))return null;
            const sizes=id.startsWith('textSize')?contextIds.slice(index).filter((value,i,array)=>array.slice(0,i+1).every(entry=>entry.startsWith('textSize'))):null;
            return <span className="dm-context-entry" key={id}>{index>0&&(sizes||['bold','textAlign','strokeColor','strokeFillColor','moreOptions'].includes(id))&&<Separator/>}
              {sizes?<span className="dm-button-group">{sizes.map(contextButton)}</span>:contextButton(id)}</span>;
          })}
        </fieldset>}
        {error!=null&&<div className="dm-error" role="alert"><span>{(error as {message?:string})?.message??String(error)}</span><ToolButton aria-label="Dismiss error" icon="close" onClick={()=>setError(null)}/></div>}
      </UiContext.Provider>
    </MantineProvider>
  </div>;
}
