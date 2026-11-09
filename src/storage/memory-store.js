import { createDocumentOwner, prepareBatch, storageError, checkImmutableRecord, checkReceipt, copyAcknowledgements, checkpointMetadata, snapshotCut, isOriginJournalId } from './store-operations.js';

/** File/temporary hosts keep immutable history in memory; no browser storage is touched. */
export function createMemoryDocumentStore() {
  const owner = createDocumentOwner();
  let document;
  let tail = Promise.resolve();
  let closing = false;
  const serial = action => {
    const operation = tail.then(action); tail = operation.catch(() => {}); return operation;
  };
  const pendingOutbox = () => [...(document?.pending.values() ?? [])];
  return Object.freeze({
    async openSession(options) {
      if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
      return owner.add({ ...options, persistence: 'memory' });
    },
    async readCheckpoint(session) {
      await tail; owner.get(session);
      if (!document?.checkpoint) return null;
      return structuredClone({ ...document.checkpoint, payload: document.snapshot,
        ...(document.suffix.length ? { journal: document.suffix.map(({ id, payload }) => ({ id, payload })) } : {}) });
    },
    async readRetainedJournal(session) {
      await tail; owner.get(session);
      return structuredClone({ revision: document?.checkpoint?.revision ?? null, clock: document?.checkpoint?.clock ?? {},
        journal: [...(document?.journal.values() ?? [])].map(({ id, payload }) => ({ id, payload })) });
    },
    async commitBatch(session, value) {
      const prepared = prepareBatch(value);
      // Validation can fail while an earlier commit is queued; observe its rejection immediately.
      void prepared.catch(() => {});
      return serial(async () => {
        owner.get(session);
        const { batch, digest } = await prepared;
        owner.get(session);
        const current = document ?? { checkpoint: null, snapshot: new Uint8Array(), snapshotOrdinal: -1, nextJournalOrdinal: 0,
          outbox: new Map(), pending: new Map(), journal: new Map(), suffix: [], receipts: new Map() };
        const receipt = current.receipts.get(batch.batchId);
        if (receipt) {
          const confirmed = checkReceipt(receipt, digest);
          for (const entry of batch.outbox) checkImmutableRecord(current.outbox.get(entry.id), entry, 'outbox', true);
          for (const entry of batch.journal ?? []) checkImmutableRecord(current.journal.get(entry.id), entry, 'journal', true);
          return confirmed;
        }
        if ((current.checkpoint?.revision ?? null) !== batch.expectedRevision) throw storageError('StorageConflict', 'Checkpoint revision changed.');
        // Validate every immutable identity before mutating anything. Copying all history on
        // each append would make the in-memory implementation quadratic as documents grow.
        for (const entry of batch.outbox) {
          checkImmutableRecord(current.outbox.get(entry.id), entry, 'outbox');
        }
        for (const entry of batch.journal ?? []) {
          checkImmutableRecord(current.journal.get(entry.id), entry, 'journal');
        }
        let nextJournalOrdinal = current.nextJournalOrdinal;
        const newJournal = (batch.journal ?? []).filter(entry => !current.journal.has(entry.id))
          .map(entry => ({ ...entry, ordinal: nextJournalOrdinal++ }));
        const boundary = current.journal.get(batch.checkpoint.snapshotAfterJournalId)
          ?? newJournal.find(entry => entry.id === batch.checkpoint.snapshotAfterJournalId);
        const cut = snapshotCut(current.snapshotOrdinal, batch.checkpoint, boundary?.ordinal);
        for (const entry of batch.outbox) if (!current.outbox.has(entry.id)) {
          current.outbox.set(entry.id, entry); current.pending.set(entry.id, entry);
        }
        for (const entry of newJournal) {
          current.journal.set(entry.id, entry);
          if (!isOriginJournalId(entry.id)) current.suffix.push(entry);
        }
        current.nextJournalOrdinal = nextJournalOrdinal;
        current.checkpoint = checkpointMetadata(current.checkpoint, batch.checkpoint);
        if (batch.checkpoint.payload.length) {
          current.snapshot = batch.checkpoint.payload; current.snapshotOrdinal = cut;
          current.suffix = current.suffix.filter(entry => entry.ordinal > cut);
        }
        current.receipts.set(batch.batchId, { batchId: batch.batchId, revision: batch.checkpoint.revision, digest });
        document = current;
        return { batchId: batch.batchId, revision: batch.checkpoint.revision };
      });
    },
    async acknowledgeOutbox(session, ids) {
      const acknowledged = copyAcknowledgements(ids);
      return serial(() => {
        owner.get(session);
        for (const id of acknowledged) document?.pending.delete(id);
      });
    },
    async readOutbox(session) { await tail; owner.get(session); return structuredClone(pendingOutbox()); },
    async readReplicationState(session) {
      await tail; owner.get(session);
      return structuredClone({ clock: document?.checkpoint?.clock ?? {}, snapshotKey: document?.checkpoint?.snapshotAfterJournalId ?? 'origin',
        outbox: pendingOutbox().map(({ id, payload }) => ({ id, payload })) });
    },
    closeSession(session) { return serial(() => { owner.close(session); document = undefined; }); },
    deleteDocument(session) { return serial(() => { owner.get(session); document = undefined; }); },
    async dispose() { closing = true; await tail; owner.dispose(); document = undefined; },
  });
}
