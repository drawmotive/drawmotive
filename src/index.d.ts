/** Mount one isolated visual editor into a browser element. */
export interface EditorInitializeOptions {
  container: HTMLElement;
  /** Directory containing the copied embed.html and its runtime assets. */
  assetBaseUrl?: string | URL;
  /** Initial TextGraph source. Mutually exclusive with document. */
  source?: string;
  /** Opaque base64 document returned by exportDocument(). */
  document?: string;
  /** Accessible title for the editor iframe. */
  title?: string;
  /** Cancels initialization, including the initial import. */
  signal?: AbortSignal;
  /** Startup/request deadline in milliseconds. Default: 120000. */
  timeoutMs?: number;
}

export interface EditorDocument {
  /** PNG image bytes encoded as base64. */
  readonly png: string;
  /** Editable DrawMotive document encoded as base64. Persist this to reopen it. */
  readonly raw: string;
  readonly width: number;
  readonly height: number;
}

export interface EditorInstance {
  readonly state: 'ready' | 'disposing' | 'disposed';
  /** Replace the current diagram with automatically laid out TextGraph. */
  importTextGraph(source: string): Promise<void>;
  /** Replace the current diagram with an exported document. */
  importDocument(raw: string): Promise<void>;
  /** Return an editable document and its rendered PNG. */
  exportDocument(): Promise<EditorDocument>;
  /** Remove the frame and release its runtime. Safe to call more than once. */
  dispose(): Promise<void>;
}

export declare function initializeEditor(options: EditorInitializeOptions): Promise<EditorInstance>;
