import { createRuntimeChannel } from '../bridge/runtime-channel.js';
import { PROTOCOL_VERSION, EditorError } from '../bridge/protocol.js';
import { createWorkerFactory } from './worker-factory.js';

/** Own the Worker, both ports and failure subscriptions from construction onward. */
export async function createWorkerChannel({ url, instanceId, documentSessionId = null, timeoutMs = 120000,
  workerFactory = createWorkerFactory(), name, connectType, connectData = {}, failureCode }) {
  if (typeof instanceId !== 'string' || !instanceId.trim() ||
      !(documentSessionId === null || typeof documentSessionId === 'string' && documentSessionId.trim()) ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('A valid Worker scope and positive request timeout are required.');
  const handle = await workerFactory(url, { name });
  let port1, port2, channel, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    channel?.dispose();
    port1?.close(); port2?.close();
    try { handle.worker.removeEventListener?.('error', crashed); handle.worker.removeEventListener?.('messageerror', crashed); }
    finally { handle.dispose(); }
  };
  const crashed = event => {
    channel?.dispose(new EditorError(failureCode, event.message ?? 'Editor Worker failed; pending results are unconfirmed.'));
    dispose();
  };
  try {
    ({ port1, port2 } = new MessageChannel());
    channel = createRuntimeChannel({ port: port1, instanceId, documentSessionId, requestTimeoutMs: timeoutMs });
    handle.worker.addEventListener('error', crashed);
    handle.worker.addEventListener('messageerror', crashed);
    handle.worker.postMessage({ ...connectData, type: connectType, protocolVersion: PROTOCOL_VERSION, instanceId, documentSessionId, port: port2 }, [port2]);
    return Object.freeze({ channel, dispose });
  } catch (error) { channel?.dispose(error); dispose(); throw error; }
}
