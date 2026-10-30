import Dexie, { type Table } from 'dexie';
import type { DocumentCheckpoint, DocumentOutboxEntry, DocumentSession, DocumentSessionOptions, DocumentStore, DocumentCommitBatch } from '../document-store.js';
import { createDocumentOwner, prepareBatch, storageError, equalOutbox, checkReceipt, documentKey, copyAcknowledgements } from '../store-operations.js';

interface DocumentRow { key: string; checkpoint: DocumentCheckpoint; nextOrdinal: number; }
interface OutboxRow extends DocumentOutboxEntry { documentKey: string; ordinal: number; }
interface ReceiptRow { documentKey: string; batchId: string; revision: string; fingerprint: string; }
interface DatabaseOptions { databaseName?: string; acquireWriter?: (key: string) => Promise<() => void>; }

async function acquireWriter(key: string): Promise<() => void> {
  if (typeof navigator === 'undefined' || !navigator.locks)
    throw storageError('StorageUnavailable', 'Persistent editing requires origin-wide writer locks.');
  return new Promise((resolve, reject) => {
    navigator.locks.request('drawmotive:writer:' + key, { ifAvailable: true }, lock => {
      if (!lock) { reject(storageError('StorageConflict', 'This document is already open for writing.')); return; }
      return new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}

/** Imported only by document.worker.ts (Node imports are test-only). No UI-thread DB facade. */
export function createDocumentDatabase(options: DatabaseOptions = {}): DocumentStore & { dispose(): Promise<void> } {
  const db = new Dexie(options.databaseName ?? 'drawmotive-documents-v1');
  db.version(1).stores({ documents: 'key', outbox: '[documentKey+id], documentKey, [documentKey+ordinal]', receipts: '[documentKey+batchId], documentKey' });
  const documents: Table<DocumentRow, string> = db.table('documents');
  const outbox: Table<OutboxRow, [string, string]> = db.table('outbox');
  const receipts: Table<ReceiptRow, [string, string]> = db.table('receipts');
  const owner = createDocumentOwner();
  // Node's fake-indexeddb tests have no navigator. Production Workers must acquire a real Web Lock.
  const lock = options.acquireWriter ?? acquireWriter;
  let closing = false;
  return Object.freeze({
    async openSession(configuration: DocumentSessionOptions) {
      if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
      const key = documentKey(configuration);
      const release = await lock(key);
      try {
        if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
        await db.open();
        if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
        return owner.add(configuration, release);
      }
      catch (error) { release(); if (closing) db.close(); throw error; }
    },
    async readCheckpoint(session: DocumentSession) {
      const { key } = owner.get(session);
      return structuredClone((await documents.get(key))?.checkpoint ?? null);
    },
    async commitBatch(session: DocumentSession, value: DocumentCommitBatch) {
      const { key } = owner.get(session), { batch, fingerprint } = await prepareBatch(value);
      owner.get(session);
      return db.transaction('rw', documents, outbox, receipts, async () => {
        const receipt = await receipts.get([key, batch.batchId]);
        if (receipt) return checkReceipt(receipt, fingerprint);
        const current = await documents.get(key);
        if ((current?.checkpoint.revision ?? null) !== batch.expectedRevision) throw storageError('StorageConflict', 'Checkpoint revision changed.');
        let nextOrdinal = current?.nextOrdinal ?? 0;
        await documents.put({ key, checkpoint: batch.checkpoint, nextOrdinal });
        for (const entry of batch.outbox) {
          const existing = await outbox.get([key, entry.id]);
          if (existing && !equalOutbox(existing, entry)) throw storageError('BatchConflict', 'Outbox identities cannot change.');
          if (!existing) await outbox.put({ ...entry, documentKey: key, ordinal: nextOrdinal++ });
        }
        await documents.update(key, { nextOrdinal });
        await receipts.put({ documentKey: key, batchId: batch.batchId, revision: batch.checkpoint.revision, fingerprint });
        return { batchId: batch.batchId, revision: batch.checkpoint.revision };
      });
    },
    async acknowledgeOutbox(session: DocumentSession, ids: readonly string[]) {
      const { key } = owner.get(session);
      const acknowledged = copyAcknowledgements(ids);
      await db.transaction('rw', outbox, () => outbox.bulkDelete(acknowledged.map(id => [key, id])));
    },
    async readOutbox(session: DocumentSession) {
      const { key } = owner.get(session);
      return (await outbox.where('documentKey').equals(key).sortBy('ordinal')).map(({ id, revision, payload }) => ({ id, revision, payload }));
    },
    async readReplicationState(session: DocumentSession) {
      const { key } = owner.get(session);
      // Transport must never combine an older clock with a newer outbox read.
      return db.transaction('r', documents, outbox, async () => ({
        clock: structuredClone((await documents.get(key))?.checkpoint.clock ?? {}),
        outbox: (await outbox.where('documentKey').equals(key).sortBy('ordinal')).map(({ id, payload }) => ({ id, payload })),
      }));
    },
    async closeSession(session: DocumentSession) { owner.close(session); },
    async deleteDocument(session: DocumentSession) {
      const { key } = owner.get(session);
      await db.transaction('rw', documents, outbox, receipts, async () => {
        await documents.delete(key);
        await outbox.where('documentKey').equals(key).delete();
        await receipts.where('documentKey').equals(key).delete();
      });
    },
    async dispose() { closing = true; owner.dispose(); db.close(); },
  });
}
