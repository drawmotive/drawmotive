import { initializeTextGraph as defaultInitializeTextGraph } from '@drawmotive/textgraph';

export const abiManifest = Object.freeze({
  packageName: '@drawmotive/editor',
  packageVersion: '0.0.0-development',
  abiVersion: '1.0.0',
});

/** Initializes TextGraph first and then creates one editor runtime instance. */
export async function initializeEditor(options = {}) {
  const initializeTextGraph = options.initializeTextGraph ?? defaultInitializeTextGraph;
  const textgraph = await initializeTextGraph(options.textGraphOptions ?? options);
  try {
    if (typeof options.loadRuntime !== 'function') {
      throw new TypeError('initializeEditor requires a loadRuntime function');
    }
    return await options.loadRuntime({ ...options, textgraph });
  } catch (error) {
    await textgraph.dispose?.();
    throw error;
  }
}
