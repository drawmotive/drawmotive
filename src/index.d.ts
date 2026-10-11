/** One immutable document/interaction state owned by the editor runtime. */
export interface EditorState {
  readonly revision: string | null;
  readonly health: 'healthy' | 'faulted';
  readonly editingEnabled: boolean;
  readonly busy: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}
export type EditorButtonId = 'undo' | 'redo' | 'arrow' | 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'sketchyMode' | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'settings' | 'help';
export interface EditorActionState { label?: string; enabled?: boolean; visible?: boolean; }
export interface EditorAction extends EditorActionState {
  /** Stable action ID in the host. namespace. */
  id: string;
  label: string;
  icon?: string;
  /** Handler remains in the parent window; disposal cancels signal. */
  onInvoke(context: { editor: EditorInstance; signal: AbortSignal }): void | Promise<void>;
}
export interface EditorCreateOptions {
  container: HTMLElement;
  /** HTTP(S) directory containing embed.html and its complete runtime. */
  assetBaseUrl?: string | URL;
  title?: string;
  ui?: { buttons?: Partial<Record<EditorButtonId, boolean>>; actions?: readonly EditorAction[] };
  /** Defaults are all false. Enabling a module absent from the build fails. */
  modules?: { analytics?: boolean; authentication?: boolean; remoteSync?: boolean };
  /** Cancels startup only. Explicit dispose owns a returned instance. */
  signal?: AbortSignal;
  /** Defaults to 120000 ms. */
  startupTimeoutMs?: number;
  /** Defaults to 120000 ms. An operation deadline preserves the document. */
  requestTimeoutMs?: number;
  /** Defaults to 5000 ms. Explicit disposal always removes the frame. */
  disposeTimeoutMs?: number;
}
export interface SnapshotOptions {
  formats: readonly ('raw' | 'png' | 'svg')[];
  png?: { embedDocument?: boolean };
  render?: { scale?: number; maxWidth?: number; padding?: number; roundSvgNumbers?: boolean };
}
export interface EditorSnapshot {
  readonly revision: string;
  readonly raw?: string;
  readonly png?: { readonly base64: string; readonly width: number; readonly height: number; readonly scale: number; readonly displayWidth: number; readonly displayHeight: number };
  readonly svg?: string;
}
export interface ViewportOptions { padding?: number; minScale?: number; maxScale?: number; }
export interface EditorInstance {
  readonly lifecycle: 'ready' | 'disposing' | 'disposed';
  /** Successful replacements reset selection/history and never fit the viewport. */
  replaceDocument(raw: string): Promise<void>;
  replacePngDocument(base64: string): Promise<void>;
  replaceTextGraph(source: string): Promise<void>;
  clearDocument(): Promise<void>;
  /** All requested formats share one revision; exporting never means saved. */
  exportSnapshot(options: SnapshotOptions): Promise<EditorSnapshot>;
  fitViewport(options?: ViewportOptions): Promise<void>;
  setEditingEnabled(enabled: boolean): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  getState(): Promise<EditorState>;
  /** Immediately receives current state, then changes. Unsubscribe is idempotent. */
  onStateChanged(listener: (state: EditorState) => void): () => void;
  setActionState(id: string, state: EditorActionState): Promise<void>;
  /** Idempotent. Rejects DisposeCleanupUnconfirmed if storage cleanup is unknown. */
  dispose(): Promise<void>;
}
export interface EditorRequestCompletion<T = unknown> { result?: T; error?: Error; }
export declare class EditorError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly method?: string;
  /** RequestTimeoutUnknown retains late-result ownership without retrying. */
  readonly completion?: Promise<EditorRequestCompletion>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function createEditor(options: EditorCreateOptions): Promise<EditorInstance>;
