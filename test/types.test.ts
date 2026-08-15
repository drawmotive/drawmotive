import {
  initializeEditor,
  type EditorInstance,
  type EditorInitializeOptions,
  type EditorRuntimeManifest,
} from '../src/index.js';

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
