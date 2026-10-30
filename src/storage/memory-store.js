import { createDocumentOwner, prepareBatch, storageError, equalOutbox, checkReceipt, copyAcknowledgements } from './store-operations.js';

/** File/temporary hosts keep their checkpoint in memory; no browser storage is touched. */
export function createMemoryDocumentStore() {
  const owner = createDocumentOwner();
  let document;
  let tail = Promise.resolve();
  let closing = false;
  const serial = action => {
    const operation = tail.then(action); tail = operation.catch(() => {}); return operation;
  };
  return Object.freeze({
    async openSession(options) {
      if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
      return owner.add({ ...options, persistence: 'memory' });
    },
    async readCheckpoint(session) { await tail; owner.get(session); return structuredClone(document?.checkpoint ?? null); },
    async commitBatch(session, value) {
      const prepared = prepareBatch(value);
      // Validation may fail before an earlier queued commit finishes. Observe the
      // rejection immediately while preserving the original failure for this call.
      void prepared.catch(() => {});
      return serial(async () => {
        owner.get(session);
        const { batch, fingerprint } = await prepared;
        owner.get(session);
        const current = document ?? { checkpoint: null, outbox: [], receipts: new Map() };
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
        document = next;
        return { batchId: batch.batchId, revision: batch.checkpoint.revision };
      });
    },
    async acknowledgeOutbox(session, ids) {
      const acknowledged = copyAcknowledgements(ids);
      return serial(() => {
        owner.get(session); const current = document;
        if (current) current.outbox = current.outbox.filter(entry => !acknowledged.includes(entry.id));
      });
    },
    async readOutbox(session) { await tail; owner.get(session); return structuredClone(document?.outbox ?? []); },
    closeSession(session) { return serial(() => { owner.close(session); document = undefined; }); },
    deleteDocument(session) { return serial(() => { owner.get(session); document = undefined; }); },
    async dispose() { closing = true; await tail; owner.dispose(); document = undefined; },
  });
}
