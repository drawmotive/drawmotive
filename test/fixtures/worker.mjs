import { parentPort } from 'node:worker_threads';
import { initializeEditor, platform } from '@drawmotive/editor/worker';

const instance = await initializeEditor({
  initializeTextGraph: async () => ({ dispose: async () => undefined }),
  loadRuntime: async () => ({ abiVersion: '1.0.0' }),
});
parentPort.postMessage({ platform, state: instance.state });
