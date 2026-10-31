import type { EditorUiOptions, NormalizedUiOptions, EditorUiActionState } from './react/ui-options.js';
export { EditorError } from './errors.js';
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
/** Detached generated model values; a new native property needs no SDK DTO. */
export type EditorModelValue = null | boolean | number | string | EditorModelObject | readonly EditorModelValue[];
export interface EditorModelObject { readonly [name: string]: EditorModelValue; }
export interface EditorModelProperty {
  readonly name: string; readonly kind: string; readonly writable: boolean; readonly nullable: boolean;
  readonly values?: readonly string[] | null; readonly properties?: readonly EditorModelProperty[] | null;
}
export interface EditorModelOperation { readonly name: string; readonly parameters: readonly string[]; }
export interface EditorModelSchema {
  readonly type: string; readonly properties: readonly EditorModelProperty[]; readonly operations: readonly EditorModelOperation[];
}
export interface EditorModelSnapshot { readonly type: string; readonly model: EditorModelObject; readonly schema: EditorModelSchema; }
export interface EditorSceneObject extends EditorModelSnapshot { readonly id: string; }
export interface EditorSceneSnapshot { readonly revision: string; readonly metadata: EditorModelSnapshot; readonly items: readonly EditorSceneObject[]; }
export type EditorSceneChange = { readonly itemId?: string | null; readonly path: readonly string[] } & (
  { readonly op?: 'set'; readonly value: EditorModelValue } |
  { readonly op: 'remove' } |
  { readonly op: 'call'; readonly arguments: readonly EditorModelValue[] }
);
export interface EditorSceneEdit {
  readonly revision: string; readonly description: string; readonly changes: readonly EditorSceneChange[]; readonly token?: EditorSelectionToken;
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
  readonly capabilities: EditorCapabilities; readonly model: EditorModelObject; readonly resolved: EditorModelObject; readonly screenBounds: EditorScreenBounds;
  readonly text?: string | null; readonly boundText?: EditorSelectedObject | null;
  readonly startAttachment?: EditorAttachment | null; readonly endAttachment?: EditorAttachment | null; readonly routingUnavailable: boolean;
}
export interface EditorSelectionSnapshot {
  readonly revision: string;
  readonly token: EditorSelectionToken;
  readonly items: readonly EditorSelectedObject[];
  readonly anchor: EditorScreenBounds | null;
}
/** Opaque immutable MemoryPack graph; JS never mutates the graph or remaps IDs. */
export interface EditorSelectionPayload { readonly version: 1; readonly data: string; readonly png?: string | null; }
export interface EditorSelectionCopyOptions { png?: boolean; }
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
  getScene(): Promise<EditorSceneSnapshot>;
  /** Validates and commits every change as one native document transaction. */
  editScene(edit: EditorSceneEdit): Promise<void>;
  deleteSelection(token: EditorSelectionToken): Promise<void>;
  /** Cancels the active preview or inline text session before clearing selection. */
  cancelInteraction(): Promise<void>;
  /** Acquires temporary canvas panning; false means the current interaction owns input. */
  beginPan(): Promise<boolean>;
  endPan(): Promise<void>;
  repeatLastTool(): Promise<void>;
  /** Replays a drag at its current pointer position with the supplied modifiers. */
  updateInteractionModifiers(modifiers: { alt: boolean; shift: boolean }): Promise<void>;
  beginTextEditing(targetItemId?: string): Promise<void>;
  applyText(token: EditorSelectionToken, targetItemId: string, content: string): Promise<void>;
  /** Optional PNG is rendered from the same native selection capture as the graph. */
  copySelection(token: EditorSelectionToken, options?: EditorSelectionCopyOptions): Promise<EditorSelectionPayload>;
  pasteSelection(payload: EditorSelectionPayload, position: { x: number; y: number }): Promise<EditorSelectionSnapshot>;
  copyToClipboard(token:EditorSelectionToken,options?:EditorClipboardCopyOptions):Promise<EditorClipboardCopyResult>;
  /** Omitted position uses the native canvas pointer in drawing/model coordinates. */
  pasteFromClipboard(position?:{x:number;y:number},options?:EditorClipboardPasteOptions):Promise<EditorSelectionSnapshot>;
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
