import { Checkbox, NativeSelect } from '@mantine/core';
import type { EditorPreferences, EditorPropertyChange, EditorPropertyValues, EditorSelectedObject } from '../core.js';
import { Icon, EndpointIcon, PaletteIcon } from './icons.js';
import { colorCss, PanelButton, PanelHeading, Separator, ToolButton, uniform, useUi } from './controls.js';
import { selectionSubjects } from './ui-model.js';

const strokeRoles=['Transparent','Foreground','PrimaryStroke','SecondaryStroke','AccentStroke','SuccessStroke','WarningStroke'];
const fillRoles=['Transparent','Background','PrimaryFill','SecondaryFill','AccentFill','SuccessFill','WarningFill'];
const groupRoles=['PrimaryStroke','SecondaryStroke','AccentStroke','SuccessStroke','WarningStroke'];

export function Colors({fill=false,target}: {fill?:boolean;target?:EditorSelectedObject}) {
  const {selection,property}=useUi(), properties=target?.properties??selection!.properties;
  return <>{(fill?['StrokeColor','FillColor']:['StrokeColor']).map(command=>{
    const isFill=command==='FillColor', roles=isFill?fillRoles:strokeRoles, selected=uniform(isFill?properties.fillColor:properties.strokeColor);
    return <div key={command}><PanelHeading>{isFill?'Fill Color':fill?'Border Color':'Color'}</PanelHeading>
      <div className="dm-panel-row">{roles.map(role=><ToolButton key={role} aria-label={role==='Transparent'?(isFill?'No Fill':'No Border'):role.replace(/(Stroke|Fill)$/,'')+' color'}
        selected={selected?.role===role&&selected.argb===null} data-testid={'panel-'+(isFill?'fill':'stroke')+'-color-'+role.toLowerCase()}
        onClick={()=>void property({command:command as 'StrokeColor'|'FillColor',color:role,...(target?{targetItemId:target.id}:{})})}>
        {role==='Transparent'?<span className="dm-transparent">∅</span>:<PaletteIcon fill={isFill?colorCss(role):'none'} style={{color:colorCss(role)}} />}
      </ToolButton>)}</div></div>;
  })}</>;
}

export function StrokePanel() {
  const {selection,property}=useUi(),p=selection!.properties;
  return <><PanelHeading>Line Width</PanelHeading><div className="dm-panel-row">{['Thin','Normal','Bold'].map((width,index)=><ToolButton key={width}
    aria-label={width+' line'} selected={uniform(p.strokeWidth)===width} data-testid={'panel-stroke-width-'+index} onClick={()=>void property({command:'StrokeWidth',width})}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 12h18" stroke="currentColor" strokeWidth={[1,2,4][index]} /></svg>
  </ToolButton>)}</div><PanelHeading>Line Style</PanelHeading><div className="dm-panel-row">{['Solid','Dashed','Dotted'].map((stroke,index)=><ToolButton key={stroke}
    aria-label={stroke+' line'} selected={uniform(p.strokeStyle)===stroke} data-testid={'panel-stroke-style-'+index} onClick={()=>void property({command:'StrokeStyle',stroke})}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 12h20" stroke="currentColor" strokeWidth="2" strokeDasharray={['none','5 3','1 3'][index]} strokeLinecap="round" /></svg>
  </ToolButton>)}</div></>;
}

export function AlignPanel({target}: {target?:EditorSelectedObject}) {
  const {selection,property}=useUi(),items=target?[target]:selectionSubjects(selection!.items),p=target?.properties??selection!.properties;
  return <>{[false,...(items.every(item=>item.capabilities.verticalTextAlignment)?[true]:[])].map(vertical=><div className="dm-panel-row" key={String(vertical)}>{(vertical?['Top','Center','Bottom']:['Left','Center','Right']).map((alignment,index)=><ToolButton key={alignment}
    aria-label={(vertical?'Vertical ':'Horizontal ')+alignment} selected={uniform(vertical?p.verticalAlignment:p.horizontalAlignment)===alignment}
    data-testid={'panel-text-align-'+(vertical?'vertical':'horizontal')+'-'+alignment.toLowerCase()} onClick={()=>void property({command:vertical?'VerticalAlignment':'HorizontalAlignment',...(vertical?{verticalAlignment:alignment}:{horizontalAlignment:alignment}),...(target?{targetItemId:target.id}:{})})}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" style={vertical?{transform:'rotate(90deg)'}:undefined}>
      <path d={'M3 4h18M3 14h18M'+[3,7,11][index]+' 9h10M'+[3,7,11][index]+' 19h10'} />
    </svg>
  </ToolButton>)}</div>)}</>;
}

export function EndpointPanel({start}: {start:boolean}) {
  const {selection,property}=useUi(),selected=uniform(start?selection!.properties.lineStartStyle:selection!.properties.lineEndStyle);
  return <div className="dm-endpoint-grid">{['None','Simple arrow','Filled arrow','Open arrow','Circle','Diamond'].map((label,index)=><ToolButton key={label}
    aria-label={label} selected={selected===index} data-testid={'panel-line-'+(start?'start':'end')+'-style-'+index}
    onClick={()=>void property({command:start?'LineStartStyle':'LineEndStyle',endpointStyle:index})}><EndpointIcon value={index} start={start} /></ToolButton>)}</div>;
}

export function RoutingPanel() {
  const {selection,property}=useUi(),connector=selection!.items.every(item=>item.capabilities.connectorRouting);
  return <div className="dm-panel-row">{['Straight','Orthogonal','Curved'].map((routing,index)=><ToolButton key={routing} aria-label={routing}
    selected={uniform(selection!.properties.lineRouting)===routing} disabled={routing!=='Straight'&&!connector} data-testid={'panel-line-connector-style-'+index}
    onClick={()=>void property({command:'LineRouting',routing})}>
    <svg viewBox="0 0 28 24" width="25" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={['M3 21 24 3','M3 21V3h21','M3 21C3 3 24 21 24 3'][index]} /><path d="m18 3 6 0v6" /></svg>
  </ToolButton>)}</div>;
}

export function AttachmentPanel() {
  const {selection,property}=useUi(),item=selection!.items[0];
  if(selection!.items.length!==1)return <p>Select one line to change attachments.</p>;
  return <>{[true,false].map(start=>{
    const endpoint=start?item.startAttachment:item.endAttachment;
    if(!endpoint)return null;
    const attachment=endpoint.attachment, selected=attachment.kind==='Object'?(attachment.boundaryId??'Free'):'Free';
    const options=[{value:'Free',label:'Free'},...endpoint.boundaryIds.map(id=>({value:id,label:id}))];
    if(endpoint.unresolved&&!options.some(option=>option.value===selected))options.push({value:selected,label:'Unresolved: '+selected});
    return <div key={String(start)}><NativeSelect label={(start?'Start':'End')+' attachment'} aria-label={(start?'Start':'End')+' attachment'} data-testid={'line-'+(start?'start':'end')+'-attachment'}
      data={options} value={selected} onChange={event=>void property({command:start?'StartAttachment':'EndAttachment',boundaryId:event.currentTarget.value==='Free'?null:event.currentTarget.value})} />
      {endpoint.unresolved&&<div role="status" className="dm-warning">This attachment is unavailable. Reconnect the endpoint or choose Free.</div>}
    </div>;
  })}{item.routingUnavailable&&<div role="status" className="dm-warning" data-testid="line-routing-failure">No valid route is available. The attachment choice is preserved.</div>}</>;
}

export function GroupPanel({inline=false}: {inline?:boolean}) {
  const {selection,property}=useUi(),p=selection!.properties;
  return <div className={inline?'dm-group-controls':'dm-panel-stack'}><NativeSelect aria-label="Group theme color" label={inline?undefined:'Group theme color'} size="xs" value={uniform(p.groupColorRole)??'auto'}
    data={[{value:'auto',label:p.groupColorRole.state==='Mixed'?'Mixed':'Theme default'},...groupRoles.map(role=>({value:role,label:role.replace('Stroke','')}))]}
    onChange={event=>void property({command:'GroupColorRole',color:event.currentTarget.value==='auto'?null:event.currentTarget.value})} />
    <ToolButton icon="groupTheme" aria-label="Toggle title background" data-testid="group-title-background" selected={uniform(p.groupHeaderVisible)===true} onClick={()=>void property({command:'GroupHeaderVisible',enabled:uniform(p.groupHeaderVisible)!==true})}/>
    <ResetSelect label="Restore group theme defaults" prompt="Theme defaults" testId="group-theme-reset" choices={['All','Border','Body','Line','Corners','Opacity','Header']} onChange={groupReset=>property({command:'ResetGroupStyle',groupReset})}/>
  </div>;
}

export function ResetSelect({label,prompt,testId,choices,onChange}: {label:string;prompt?:string;testId:string;choices:string[];onChange:(value:string)=>Promise<unknown>}) {
  return <NativeSelect aria-label={label} data-testid={testId} size="xs" value="prompt" data={[{value:'prompt',label:prompt??label},...choices.map(value=>({value,label:'Restore '+value.toLowerCase()}))]}
    onChange={event=>{if(event.currentTarget.value!=='prompt')void onChange(event.currentTarget.value);}} />;
}

export function TitlePanel() {
  const {selection,property}=useUi(),title=selection!.items[0]?.boundText;
  if(!title)return null;
  const change=(value:EditorPropertyChange)=>property({...value,targetItemId:title.id});
  return <div className="dm-title-controls"><PanelButton id="title-color" label="Title color" nested button={<ToolButton icon="strokeColor"/>}><Colors target={title}/></PanelButton>
    <Separator/><TextButtons properties={title.properties} change={change}/>
    <PanelButton id="title-align" label="Title alignment" nested button={<ToolButton icon="textAlign"/>}><AlignPanel target={title}/></PanelButton>
    <ResetSelect label="Restore title theme style" prompt="Title theme defaults" testId="group-title-theme-reset" choices={['All','Color','Size','Weight','Slant','Alignment']} onChange={titleReset=>property({command:'ResetGroupTitleStyle',titleReset})}/>
  </div>;
}
export function TextButtons({properties:p,change}: {properties:EditorPropertyValues;change:(value:EditorPropertyChange)=>Promise<unknown>}) {
  return <div className="dm-panel-row"><span className="dm-button-group">{['Small','Medium','Large'].map(fontSize=><ToolButton key={fontSize} icon={'textSize'+fontSize} selected={uniform(p.textSize)===fontSize}
    onClick={()=>void change({command:'TextSize',fontSize})} />)}</span>
    <ToolButton icon="bold" selected={uniform(p.bold)===true} onClick={()=>void change({command:'ToggleBold'})}/><ToolButton icon="italic" selected={uniform(p.italic)===true} onClick={()=>void change({command:'ToggleItalic'})}/>
  </div>;
}

export function SettingsPanel({preferences,onChange}: {preferences:EditorPreferences;onChange:(value:EditorPreferences)=>Promise<unknown>}) {
  return <div className="dm-panel-stack"><Checkbox label="Dark Theme" data-testid="settings-dark-theme" checked={preferences.darkTheme??false} onChange={event=>void onChange({darkTheme:event.currentTarget.checked})}/>
    <Checkbox label="Show and Snap to Grid" data-testid="settings-show-grid" checked={preferences.showGrid??true} onChange={event=>void onChange({showGrid:event.currentTarget.checked,snapToGrid:event.currentTarget.checked})}/>
  </div>;
}

export function MorePanel({copy}: {copy:()=>Promise<unknown>}) {
  const {editor,selection,run,setPanel}=useUi();
  return <div className="dm-panel-stack">{['Copy','Delete'].map(label=><ToolButton key={label} aria-label={label} data-testid={'panel-more-options-'+label.toLowerCase()} className="dm-menu-item"
    onClick={()=>void run(async()=>{if(label==='Copy')await copy();else await editor.deleteSelection(selection!.token);setPanel(null);})}><Icon name={label.toLowerCase()}/><span>{label}</span></ToolButton>)}</div>;
}
