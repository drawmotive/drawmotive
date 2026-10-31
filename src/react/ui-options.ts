import type { EditorInstance } from '../index.js';

export type EditorButtonId = 'undo' | 'redo' | 'arrow' | 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'sketchyMode' | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'settings' | 'help';
export type EditorRegionId = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export type DrawingToolId = 'arrow' | 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'sketchyMode';
export type TextEditingMode = 'inline' | 'external' | 'disabled';
/** Slots name React content resolved by the local UI; elements never cross a port. */
export type EditorRegionItem = EditorButtonId | `host.${string}` | `slot.${string}`;

export interface EditorUiActionState { label?: string; enabled?: boolean; visible?: boolean; }
export interface EditorUiAction extends EditorUiActionState {
  id: `host.${string}`;
  label: string;
  icon?: string;
  onInvoke(context: { editor: EditorInstance; signal: AbortSignal }): void | Promise<void>;
}
export interface EditorRegionOptions {
  visible?: boolean;
  /** Item order is preserved. Hidden buttons retain their semantic capabilities. */
  items?: readonly EditorRegionItem[];
}
export interface DrawingToolbarOptions {
  visible?: boolean;
  position?: 'left' | 'right' | 'top' | 'bottom';
  tools?: readonly DrawingToolId[];
}
export interface ContextToolbarOptions {
  visible?: boolean;
  /** Omitted lists include every supported object type, tool or panel. */
  objectTypes?: readonly string[];
  tools?: readonly string[];
  panels?: readonly string[];
}
export interface EditorTooltipOptions { visible?: boolean; position?: 'top' | 'bottom' | 'left' | 'right'; delay?: number; }
/** Shared by the full, core and React entry points; no product or account state. */
export interface EditorUiOptions {
  enabled?: boolean;
  buttons?: Partial<Record<EditorButtonId, boolean>>;
  actions?: readonly EditorUiAction[];
  regions?: Partial<Record<EditorRegionId, boolean | EditorRegionOptions>>;
  drawingToolbar?: boolean | DrawingToolbarOptions;
  contextToolbar?: boolean | ContextToolbarOptions;
  /** Defaults to inline, including when all UI chrome is disabled. */
  textEditing?: TextEditingMode;
  tooltip?: boolean | EditorTooltipOptions;
}
export interface EditorActionDescriptor {
  readonly id: `host.${string}`;
  readonly label: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly icon?: string;
}
export interface NormalizedUiOptions {
  readonly enabled: boolean;
  readonly buttons: Readonly<Record<EditorButtonId, boolean>>;
  readonly actions: readonly EditorActionDescriptor[];
  readonly regions: Readonly<Record<EditorRegionId, { readonly visible: boolean; readonly items: readonly EditorRegionItem[] }>>;
  readonly drawingToolbar: { readonly visible: boolean; readonly position: NonNullable<DrawingToolbarOptions['position']>; readonly tools: readonly DrawingToolId[] };
  readonly contextToolbar: { readonly visible: boolean; readonly objectTypes?: readonly string[]; readonly tools?: readonly string[]; readonly panels?: readonly string[] };
  readonly textEditing: TextEditingMode;
  readonly tooltip: { readonly visible: boolean; readonly position: 'top' | 'bottom' | 'left' | 'right'; readonly delay: number };
}
export interface NormalizedUiConfiguration {
  readonly ui: NormalizedUiOptions;
  /** Only the local host owns callbacks and cancels them during disposal. */
  readonly handlers: Map<string, EditorUiAction['onInvoke']>;
}

export { EDITOR_BUTTON_IDS, EDITOR_REGION_IDS, DRAWING_TOOL_IDS, normalizeUiOptions } from './ui-options-runtime.js';
