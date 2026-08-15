import {
  initializeEditor,
  type EditorInstance,
  type EditorInitializeOptions,
  type EditorRuntimeManifest,
} from '../src/index.js';
import { createEditorRuntimeLoader, platform as browserPlatform } from '@drawmotive/editor/browser';
import { platform as nodePlatform } from '@drawmotive/editor/node';
import { createEditorRuntimeLoader as createWorkerLoader, platform as workerPlatform } from '@drawmotive/editor/worker';
// @ts-expect-error The Node entry deliberately excludes the browser/worker asset loader.
import { createEditorRuntimeLoader as createNodeLoader } from '@drawmotive/editor/node';

const options: EditorInitializeOptions = {
  initializeTextGraph: async () => ({
    state: 'ready',
    readonly: async (operation) => operation(),
    mutate: async (operation) => operation(),
    dispose: async () => undefined,
  }),
  loadRuntime: async () => ({ abiVersion: '1.0.0' }),
};

const instance: Promise<EditorInstance> = initializeEditor(options);
const manifest: EditorRuntimeManifest = {
  packageName: '@drawmotive/editor',
  packageVersion: '0.0.0-development',
  abiVersion: '1.0.0',
};

void instance;
void manifest;
const browser: 'browser' = browserPlatform;
const node: 'node' = nodePlatform;
const worker: 'worker' = workerPlatform;
void createEditorRuntimeLoader;
void createWorkerLoader;
void createNodeLoader;
void browser;
void node;
void worker;
