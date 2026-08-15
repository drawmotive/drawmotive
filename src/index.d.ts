import type {
  AdapterContext,
  FileAdapter,
  NetworkAdapter,
  TextGraphInitializeOptions,
  TextGraphInstance,
} from '@drawmotive/textgraph';

export type { AdapterContext, FileAdapter, NetworkAdapter } from '@drawmotive/textgraph';

export interface EditorRuntimeManifest {
  readonly packageName: '@drawmotive/editor';
  readonly packageVersion: string;
  readonly abiVersion: string;
}

export interface EditorInstance {
  readonly state: 'ready' | 'disposing' | 'disposed';
  readonly<T>(operation: () => T | Promise<T>): Promise<T>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}

export interface EditorRuntime {
  readonly abiVersion: string;
  dispose?(): void | Promise<void>;
}

export interface StorageAdapter {
  get(key: string, context: AdapterContext): Promise<unknown>;
  set(key: string, value: unknown, context: AdapterContext): Promise<void>;
  delete(key: string, context: AdapterContext): Promise<void>;
}

export interface ThemeAdapter {
  getCurrent(): unknown;
  subscribe(listener: (theme: unknown) => void): () => void;
}

export interface CommandAdapter {
  execute(command: string, args: readonly unknown[], context: AdapterContext): Promise<unknown>;
  subscribe(listener: (command: string, args: readonly unknown[]) => void): () => void;
}

export interface EditorAdapters {
  readonly files?: FileAdapter;
  readonly storage?: StorageAdapter;
  readonly theme?: ThemeAdapter;
  readonly commands?: CommandAdapter;
  readonly network?: NetworkAdapter;
}

export interface EditorRuntimeOptions extends EditorInitializeOptions {
  readonly textgraph: TextGraphInstance;
}

export interface EditorInitializeOptions {
  initializeTextGraph?(options: TextGraphInitializeOptions): Promise<TextGraphInstance>;
  textGraphOptions?: TextGraphInitializeOptions;
  loadRuntime(options: EditorRuntimeOptions): Promise<EditorRuntime>;
  signal?: AbortSignal;
  adapters?: EditorAdapters;
}

export declare const abiManifest: Readonly<EditorRuntimeManifest>;

export declare class DrawMotiveError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export declare function validateEditorAdapters(adapters?: EditorAdapters): Readonly<EditorAdapters>;

export declare function initializeEditor(options: EditorInitializeOptions): Promise<EditorInstance>;
