import { createWorkerChannel } from '../platform/worker-channel.js';

/** Font I/O has its own Worker and never shares the document transaction queue. */
export async function createResourceWorkerClient({
  url = new URL('../../dist/workers/resource.worker.js', import.meta.url),
  instanceId = crypto.randomUUID(), workerFactory, timeoutMs = 120000,
} = {}) {
  const handle = await createWorkerChannel({ url, instanceId, workerFactory, timeoutMs,
    name: 'drawmotive-fonts-' + instanceId, connectType: 'drawmotive:resource-connect', failureCode: 'ResourceWorkerFailed' });
  const { channel } = handle;
  let closing;
  return Object.freeze({
    load: resource => channel.request('fonts.load', resource, { lane: 'platform' }),
    dispose() {
      return closing ??= (async () => {
        try { if (!channel.disposed) await channel.request('fonts.close', {}, { lane: 'platform', timeoutMs: 5000 }); }
        finally { handle.dispose(); }
      })();
    },
  });
}
