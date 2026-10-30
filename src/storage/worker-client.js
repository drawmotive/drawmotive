import { createWorkerChannel } from '../platform/worker-channel.js';

/** One editor/document owns one Worker. The main thread never imports Dexie. */
export async function createDocumentWorkerClient({
  url = new URL('../../dist/workers/document.worker.js', import.meta.url),
  databaseName,
  workerFactory, timeoutMs = 120000,
} = {}) {
  const handle = await createWorkerChannel({ url, workerFactory, timeoutMs,
    name: 'drawmotive-document',
    connectData: { databaseName }, failureCode: 'StorageWorkerFailed' });
  const { channel } = handle;
  let disposal;
  return Object.freeze({
    openSession: options => channel.request('storage.open', options),
    readCheckpoint: session => channel.request('storage.read', { session }),
    commitBatch: (session, batch) => channel.request('storage.commit', { session, batch }),
    acknowledgeOutbox: (session, ids) => channel.request('storage.ack', { session, ids }),
    readOutbox: session => channel.request('storage.outbox', { session }),
    readReplicationState: session => channel.request('storage.replication', { session }),
    closeSession: session => channel.request('storage.closeSession', { session }),
    deleteDocument: session => channel.request('storage.delete', { session }),
    dispose() {
      return disposal ??= (async () => {
        try { if (!channel.disposed) await channel.request('storage.dispose', {}, { timeoutMs: 5000 }); }
        finally { handle.dispose(); }
      })();
    },
  });
}
