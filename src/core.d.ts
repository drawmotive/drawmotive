import type { EditorUiOptions, NormalizedUiOptions, EditorUiActionState } from './react/ui-options.js';
export { EditorError } from './bridge/protocol.js';
export type { EditorUiOptions, EditorButtonId, EditorRegionId, EditorUiAction as EditorAction, EditorUiActionState as EditorActionState } from './react/ui-options.js';
export interface EditorState {
  readonly revision: string | null;
  readonly health: 'healthy' | 'faulted';
  readonly editingEnabled: boolean;
  readonly busy: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly tool?: 'select' | 'arrow' | 'rectangle' | 'ellipse' | 'diamond' | 'text';
  readonly zoom?: number;
  readonly sketchyMode?: boolean;
}
export interface EditorWorkerHandle { readonly worker: Worker; dispose(): void; }
export type EditorWorkerFactory = (url: string | URL, options?: { name?: string }) => Promise<EditorWorkerHandle>;
export interface EditorCreateOptions {
  container: HTMLElement;
  assetBaseUrl?: string | URL;
  title?: string;
  ui?: EditorUiOptions | false;
  /** One instance owns one logical document. Switching documents recreates the instance. */
  persistence?: { mode: 'memory'; namespace?: string; documentId?: string } | { mode: 'persistent'; namespace: string; documentId: string };
  workerFactory?: EditorWorkerFactory;
  workerUrls?: { document?: string | URL; resource?: string | URL };
  signal?: AbortSignal;
  startupTimeoutMs?: number;
  disposeTimeoutMs?: number;
}
export interface SnapshotOptions {
  formats: readonly ('raw' | 'png' | 'svg')[];
  png?: { embedDocument?: boolean };
  render?: { scale?: number; maxWidth?: number; padding?: number; roundSvgNumbers?: boolean };
}
export interface EditorSnapshot {
  readonly revision: string;
  readonly raw?: string | null;
  readonly png?: { readonly base64: string; readonly width: number; readonly height: number; readonly scale: number; readonly displayWidth: number; readonly displayHeight: number } | null;
  readonly svg?: string | null;
}
export interface ViewportOptions { padding?: number; minScale?: number; maxScale?: number; }
export interface EditorSelectionToken { readonly session: string; readonly version: number; }
export interface EditorScreenBounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; }
export type EditorValue<T> = { readonly state: 'Unavailable' | 'Mixed'; readonly value?: T | null } | { readonly state: 'Uniform'; readonly value: T };
export interface EditorColorValue { readonly role: string; readonly argb: number | null; }
export interface EditorPropertyValues {
  readonly strokeColor: EditorValue<EditorColorValue>;
  readonly fillColor: EditorValue<EditorColorValue>;
  readonly strokeWidth: EditorValue<string>;
  readonly strokeStyle: EditorValue<string>;
  readonly cornerRadius: EditorValue<number>;
  readonly textSize: EditorValue<string>;
  readonly resolvedTextSize: EditorValue<number>;
  readonly bold: EditorValue<boolean>;
  readonly italic: EditorValue<boolean>;
  readonly horizontalAlignment: EditorValue<string>;
  readonly verticalAlignment: EditorValue<string>;
  readonly lineStartStyle: EditorValue<number>;
  readonly lineEndStyle: EditorValue<number>;
  readonly lineRouting: EditorValue<string>;
  readonly groupColorRole: EditorValue<string | null>;
  readonly groupHeaderVisible: EditorValue<boolean>;
}
export interface EditorCapabilities {
  readonly stroke: boolean; readonly fill: boolean; readonly cornerRadius: boolean; readonly editText: boolean;
  readonly text: boolean; readonly verticalTextAlignment: boolean; readonly line: boolean; readonly connectorRouting: boolean;
  readonly group: boolean; readonly groupTitle: boolean;
}
export interface EditorAttachment {
  readonly attachment: { readonly kind: string; readonly ownerId: string | null; readonly boundaryId: string | null };
  readonly boundaryIds: readonly string[];
  readonly unresolved: boolean;
}
export interface EditorSelectedObject {
  readonly id: string;
  readonly kind: 'Shape' | 'Line' | 'Group' | 'IndependentText' | 'BoundText';
  readonly bindingItemId: string | null; readonly textId: string | null;
  readonly capabilities: EditorCapabilities; readonly properties: EditorPropertyValues; readonly screenBounds: EditorScreenBounds;
  readonly text?: string | null; readonly boundText?: EditorSelectedObject | null;
  readonly startAttachment?: EditorAttachment | null; readonly endAttachment?: EditorAttachment | null; readonly routingUnavailable: boolean;
}
export interface EditorSelectionSnapshot {
  readonly token: EditorSelectionToken;
  readonly items: readonly EditorSelectedObject[];
  readonly properties: EditorPropertyValues;
  readonly anchor: EditorScreenBounds | null;
}
export type EditorPropertyCommand = 'StrokeColor' | 'FillColor' | 'StrokeWidth' | 'StrokeStyle' | 'ToggleCornerRadius' |
  'TextSize' | 'ToggleBold' | 'ToggleItalic' | 'HorizontalAlignment' | 'VerticalAlignment' | 'LineStartStyle' | 'LineEndStyle' |
  'SwapLineEndpointStyles' | 'LineRouting' | 'ToggleLineElbow' | 'StartAttachment' | 'EndAttachment' | 'GroupColorRole' |
  'GroupHeaderVisible' | 'ResetGroupStyle' | 'ResetGroupTitleStyle';
export interface EditorPropertyChange {
  command: EditorPropertyCommand; targetItemId?: string; color?: string | null; width?: string; stroke?: string;
  fontSize?: string; horizontalAlignment?: string; verticalAlignment?: string; endpointStyle?: number;
  routing?: string; boundaryId?: string | null; enabled?: boolean | null; groupReset?: string; titleReset?: string;
}
/** Opaque immutable MemoryPack graph; JS never mutates the graph or remaps IDs. */
export interface EditorSelectionPayload { readonly version: 1; readonly data: string; }
export interface EditorClipboardCopyOptions { system?:boolean; }
export interface EditorClipboardCopyResult { readonly internal:true;readonly system:'written'|'denied'|'unavailable'|'skipped'; }
export interface EditorClipboardPasteOptions { source?:'auto'|'internal'|'system'; }
export interface EditorTextEditIntent { readonly targetItemId: string; readonly textId: string | null; readonly content: string; readonly screenBounds: EditorScreenBounds; }
export interface EditorPreferences { darkTheme?: boolean; showGrid?: boolean; snapToGrid?: boolean; }
export interface EditorFontCacheStatus { readonly path: string; readonly cache: 'hit' | 'stored' | 'unavailable' | 'write-failed'; readonly detail?: string; }
export interface EditorInstance {
  readonly lifecycle: 'ready' | 'disposing' | 'disposed';
  readonly ui: NormalizedUiOptions;
  replaceDocument(raw: string): Promise<void>;
  replacePngDocument(base64: string): Promise<void>;
  replaceTextGraph(source: string): Promise<void>;
  clearDocument(): Promise<void>;
  /** Explicitly retries the retained identical storage batch after an unknown receipt. */
  retryPersistence():Promise<void>;
  exportSnapshot(options: SnapshotOptions): Promise<EditorSnapshot>;
  fitViewport(options?: ViewportOptions): Promise<void>;
  setEditingEnabled(enabled: boolean): Promise<void>;
  undo(): Promise<void>; redo(): Promise<void>; getState(): Promise<EditorState>;
  onStateChanged(listener: (state: EditorState) => void): () => void;
  onUiChanged(listener: (ui: NormalizedUiOptions) => void): () => void;
  /** Called once on disposal or a forced close such as pagehide. */
  onDisposed(listener: () => void): () => void;
  onEvent(name: 'selectionChanged', listener: (selection: EditorSelectionSnapshot) => void): () => void;
  onEvent(name: 'textEditingRequested', listener: (intent: EditorTextEditIntent) => void): () => void;
  onEvent(name: 'fontCacheStatus', listener: (status: EditorFontCacheStatus) => void): () => void;
  getSelection(): Promise<EditorSelectionSnapshot>;
  setTool(tool: 'select' | 'arrow' | 'rectangle' | 'ellipse' | 'diamond' | 'text'): Promise<void>;
  setProperty(token: EditorSelectionToken, change: EditorPropertyChange): Promise<void>;
  deleteSelection(token: EditorSelectionToken): Promise<void>;
  beginTextEditing(targetItemId?: string): Promise<void>;
  applyText(token: EditorSelectionToken, targetItemId: string, content: string): Promise<void>;
  copySelection(token: EditorSelectionToken): Promise<EditorSelectionPayload>;
  pasteSelection(payload: EditorSelectionPayload, position: { x: number; y: number }): Promise<EditorSelectionSnapshot>;
  copyToClipboard(token:EditorSelectionToken,options?:EditorClipboardCopyOptions):Promise<EditorClipboardCopyResult>;
  pasteFromClipboard(position:{x:number;y:number},options?:EditorClipboardPasteOptions):Promise<EditorSelectionSnapshot>;
  getPreferences(): Promise<EditorPreferences>;
  /** Replays a known value, then reports only authoritative successful runtime changes. */
  onPreferencesChanged(listener:(preferences:EditorPreferences)=>void):()=>void;
  /** Includes startup fonts; unavailable/write-failed means verified online bytes without persistent caching. */
  getFontCacheStatus(): readonly EditorFontCacheStatus[];
  setSketchyMode(enabled: boolean): Promise<void>;
  setPreferences(preferences: EditorPreferences): Promise<void>;
  zoom(direction: 'in' | 'out' | 'reset'): Promise<void>;
  invokeAction(id: string): Promise<void>;
  setActionState(id: string, state: EditorUiActionState): Promise<void>;
  /** Persistent data survives disposal. Deadline failure means cleanup is unconfirmed. */
  dispose(): Promise<void>;
}
export declare function createEditor(options: EditorCreateOptions): Promise<EditorInstance>;
