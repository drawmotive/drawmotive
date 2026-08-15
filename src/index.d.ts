import type {
  TextGraphInitializeOptions,
  TextGraphInstance,
} from '@drawmotive/textgraph';

export interface EditorRuntimeManifest {
  readonly packageName: '@drawmotive/editor';
  readonly packageVersion: string;
  readonly abiVersion: string;
}

export interface EditorInstance {
  readonly<T>(operation: () => T | Promise<T>): Promise<T>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}

export interface EditorRuntimeOptions extends EditorInitializeOptions {
  readonly textgraph: TextGraphInstance;
}

export interface EditorInitializeOptions {
  initializeTextGraph?(options: TextGraphInitializeOptions): Promise<TextGraphInstance>;
  textGraphOptions?: TextGraphInitializeOptions;
  loadRuntime(options: EditorRuntimeOptions): Promise<EditorInstance>;
  signal?: AbortSignal;
}

export declare const abiManifest: Readonly<EditorRuntimeManifest>;

export declare function initializeEditor(options: EditorInitializeOptions): Promise<EditorInstance>;
