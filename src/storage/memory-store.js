import { sessionRegistry, prepareBatch, storageError, equalOutbox, checkReceipt, copyAcknowledgements } from './store-operations.js';

/** File/temporary hosts keep their checkpoint in memory; no browser storage is touched. */
export function createMemoryDocumentStore() {
  const registry = sessionRegistry(), documents = new Map();
  let tail = Promise.resolve();
  let closing = false;
  const serial = action => {
    const operation = tail.then(action); tail = operation.catch(() => {}); return operation;
  };
  return Object.freeze({
    async openSession(options) {
      if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
      return registry.add({ ...options, persistence: 'memory' });
    },
    async readCheckpoint(session) { await tail; const { key } = registry.get(session); return structuredClone(documents.get(key)?.checkpoint ?? null); },
    async commitBatch(session, value) {
      const prepared = prepareBatch(value);
      // Validation may fail before an earlier queued commit finishes. Observe the
      // rejection immediately while preserving the original failure for this call.
      void prepared.catch(() => {});
      return serial(async () => {
        const { key } = registry.get(session), { batch, fingerprint } = await prepared;
        const current = documents.get(key) ?? { checkpoint: null, outbox: [], receipts: new Map() };
        const receipt = current.receipts.get(batch.batchId);
        if (receipt) return checkReceipt(receipt, fingerprint);
        if ((current.checkpoint?.revision ?? null) !== batch.expectedRevision) throw storageError('StorageConflict', 'Checkpoint revision changed.');
        const next = structuredClone(current);
        next.checkpoint = batch.checkpoint;
        for (const entry of batch.outbox) {
          const existing = next.outbox.find(record => record.id === entry.id);
          if (existing && !equalOutbox(existing, entry)) throw storageError('BatchConflict', 'Outbox identities cannot change.');
          if (!existing) next.outbox.push(entry);
        }
        next.receipts.set(batch.batchId, { batchId: batch.batchId, revision: batch.checkpoint.revision, fingerprint });
        documents.set(key, next);
        return { batchId: batch.batchId, revision: batch.checkpoint.revision };
      });
    },
    async acknowledgeOutbox(session, ids) {
      const acknowledged = copyAcknowledgements(ids);
      return serial(() => {
        const { key } = registry.get(session), current = documents.get(key);
        if (current) current.outbox = current.outbox.filter(entry => !acknowledged.includes(entry.id));
      });
    },
    async readOutbox(session) { await tail; const { key } = registry.get(session); return structuredClone(documents.get(key)?.outbox ?? []); },
    closeSession(session) { return serial(() => { const { key } = registry.get(session); registry.close(session); documents.delete(key); }); },
    deleteDocument(session) { return serial(() => { const { key } = registry.get(session); documents.delete(key); }); },
    async dispose() { closing = true; await tail; registry.dispose(); documents.clear(); },
  });
}
