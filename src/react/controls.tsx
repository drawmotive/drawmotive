import { cloneElement, createContext, forwardRef, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Popover, Tooltip, UnstyledButton } from '@mantine/core';
import type { EditorInstance, EditorPropertyChange, EditorSelectionSnapshot, EditorState, EditorValue } from '../core.js';
import type { NormalizedUiOptions } from './ui-options.js';
import { Icon } from './icons.js';

export interface UiContextValue {
  editor: EditorInstance; ui: NormalizedUiOptions; state: EditorState;
  selection: EditorSelectionSnapshot | null;
  panel: string | null; setPanel(panel: string | null): void;
  run(action: () => Promise<unknown>, key?: string): Promise<boolean>;
  property(change: EditorPropertyChange): Promise<boolean>;
}
export const UiContext = createContext<UiContextValue | null>(null);
export function useUi() { const value = useContext(UiContext); if (!value) throw new Error('Editor controls need EditorUi'); return value; }
export const uniform = <T,>(value: EditorValue<T> | undefined): T | undefined => value?.state === 'Uniform' ? value.value : undefined;

export const LABELS: Record<string, string> = {
  undo:'Undo',redo:'Redo',arrow:'Arrow',rectangle:'Rectangle',ellipse:'Ellipse',diamond:'Diamond',text:'Text',sketchyMode:'Sketchy mode',
  zoomIn:'Zoom in',zoomOut:'Zoom out',resetZoom:'Reset zoom',settings:'Settings',help:'Help',strokeFillColor:'Border and Fill Color',
  strokeColor:'Color',strokeStyle:'Line style',cornerRadius:'Round corners',editText:'Edit text',textSizeSmall:'Small text',textSizeMedium:'Medium text',textSizeLarge:'Large text',
  bold:'Bold',italic:'Italic',textAlign:'Text alignment',lineStartStyle:'Start style',lineEndStyle:'End style',swapLineEndpoints:'Swap endpoints',lineRouting:'Connector type',
  lineAttachment:'Line attachment',groupTheme:'Group theme',groupTitleStyle:'Title style',moreOptions:'More options',
};
export const SHORTCUTS: Record<string,string> = {undo:'Ctrl/⌘ Z',redo:'Ctrl/⌘ Shift Z',arrow:'A',rectangle:'R',ellipse:'E',diamond:'D',text:'T',sketchyMode:'S',bold:'Ctrl/⌘ B',italic:'Ctrl/⌘ I',editText:'Enter'};

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { icon?: string; selected?: boolean | 'mixed'; shortcut?: string; }
export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton({icon,children,selected,shortcut,className = '',...props},ref) {
  const {ui} = useUi(), label = props['aria-label'] ?? LABELS[icon ?? ''] ?? icon ?? '';
  // Mantine reports the resolved side after flipping, but does not put it on the DOM.
  const [position,setPosition]=useState<string>(ui.tooltip.position);
  useEffect(()=>setPosition(ui.tooltip.position),[ui.tooltip.position]);
  return <Tooltip label={<><span className="dm-tooltip-arrow" /><span className="dm-tooltip-content">{label}{shortcut && <kbd>{shortcut}</kbd>}</span></>}
    position={ui.tooltip.position} data-position={position} onPositionChange={setPosition} offset={12} openDelay={ui.tooltip.delay} disabled={!ui.tooltip.visible} events={{hover:true,focus:true,touch:false}}
    withinPortal={false} withArrow={false} classNames={{tooltip:'dm-tooltip'}}>
    <UnstyledButton ref={ref} {...props} className={'dm-tool ' + className} aria-label={label} aria-pressed={selected}
      data-selected={selected === true ? '' : undefined}>
      {children ?? <Icon name={icon ?? ''} />}
    </UnstyledButton>
  </Tooltip>;
});

export function PanelButton({id,button,children,label,nested=false}: {id:string;button:ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;children:ReactNode;label?:string;nested?:boolean}) {
  const {panel,setPanel} = useUi();
  const [local,setLocal]=useState(false),opened=nested?local:panel===id,change=(open:boolean)=>nested?setLocal(open):setPanel(open?id:null);
  return <Popover opened={opened} onChange={change} position="top-start" offset={5} withinPortal={false} trapFocus returnFocus transitionProps={{duration:0}}
    classNames={{dropdown:'dm-panel'}}>
    <Popover.Target>{cloneElement(button,{onClick:event=>{button.props.onClick?.(event);change(!opened);}})}</Popover.Target>
    <Popover.Dropdown role="dialog" aria-label={label??LABELS[id]??id}>{children}</Popover.Dropdown>
  </Popover>;
}
export const Separator = () => <span className="dm-separator" role="separator" aria-orientation="vertical" />;
export const PanelHeading = ({children}: {children:ReactNode}) => <div className="dm-panel-heading">{children}</div>;

export function colorCss(role?: string, argb?:number|null) {
  if(argb != null) { const color=argb>>>0;return '#' + (color&0xffffff).toString(16).padStart(6,'0') + (color>>>24).toString(16).padStart(2,'0'); }
  if(role==='Transparent') return 'transparent';
  const token=(role??'Foreground').replace(/([a-z])([A-Z])/g,'$1-$2').toLowerCase().replace(/[^a-z-]/g,'');
  return 'var(--dm-color-' + token + ', currentColor)';
}
