import { resolveRuntimeAssets } from './assets.js';
import { DrawMotiveError } from './errors.js';

/** Creates the browser-compatible loader for Editor's package-owned runtime assets. */
export function createEditorRuntimeLoader(options) {
  const fetchResource = options.fetch ?? globalThis.fetch;
  if (typeof fetchResource !== 'function') throw new TypeError('A fetch implementation is required');
  const plan = resolveRuntimeAssets(options);
  return {
    plan,
    async loadAssets() {
      const loaded = new Map();
      for (const item of plan) {
        const response = await fetchResource(item.url);
        if (!response.ok) {
          throw new DrawMotiveError('RESOURCE_NOT_FOUND', `Failed to load ${item.asset.path}: HTTP ${response.status}`, {
            details: { asset: item.asset.path, status: response.status, url: item.url.href },
          });
        }
        loaded.set(item.asset.path, {
          ...item.asset,
          url: item.url,
          bytes: new Uint8Array(await response.arrayBuffer()),
        });
      }
      return loaded;
    },
  };
}

/** Initializes TextGraph before loading the editor-only WASM runtime. */
export async function initializeEditorRuntime(options) {
  const textgraph = await options.initializeTextGraph(options.textGraphOptions);
  try {
    const editor = await options.loadEditorRuntime(options.editorOptions);
    return { textgraph, editor };
  } catch (error) {
    await textgraph.dispose?.();
    throw error;
  }
}
