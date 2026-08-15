import { initializeTextGraph as defaultInitializeTextGraph } from '@drawmotive/textgraph';
import { selectTextGraphAdapters, validateEditorAdapters } from './adapters.js';
import { createManagedInstance, throwIfAborted, validateAbi, waitForInitialResource } from './runtime/lifecycle.js';

export { validateEditorAdapters } from './adapters.js';
export { DrawMotiveError } from './runtime/errors.js';
export { resolveRuntimeAssets } from './runtime/assets.js';

export const abiManifest = Object.freeze({
  packageName: '@drawmotive/editor',
  packageVersion: '0.0.0-development',
  abiVersion: '1.0.0',
});

/** Initializes TextGraph first and then creates one editor runtime instance. */
export async function initializeEditor(options = {}) {
  throwIfAborted(options.signal);
  const adapters = validateEditorAdapters(options.adapters);
  const initializeTextGraph = options.initializeTextGraph ?? defaultInitializeTextGraph;
  const textgraph = await waitForInitialResource(
    () => initializeTextGraph({
      ...(options.textGraphOptions ?? {}),
      signal: options.signal,
      adapters: selectTextGraphAdapters(adapters),
    }),
    options.signal,
  );
  try {
    if (typeof options.loadRuntime !== 'function') {
      throw new TypeError('initializeEditor requires a loadRuntime function');
    }
    const runtime = await waitForInitialResource(() => options.loadRuntime({ ...options, adapters, textgraph }), options.signal);
    await validateAbi(runtime, abiManifest.abiVersion);
    return createManagedInstance([runtime, textgraph]);
  } catch (error) {
    await textgraph.dispose?.();
    throw error;
  }
}
