import type { DocumentCheckpoint, DocumentJournalEntry, DocumentOutboxEntry, DocumentSession, DocumentSessionOptions, DocumentStore, DocumentCommitBatch } from '../document-store.js';
import { createDocumentOwner, prepareBatch, storageError, equalBytes, equalOutbox, checkReceipt, documentKey, copyAcknowledgements, checkpointMetadata } from '../store-operations.js';
import { databaseName, DocumentDatabase, type ExactReceiptRow, type HeadRow } from './schema.ts';
import { checkLegacyReceipt, migrateDocument } from './legacy-migration.ts';

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

async function readCheckpoint(db: DocumentDatabase): Promise<DocumentCheckpoint | null> {
  return db.transaction('r', db.meta, db.snapshots, db.journal, async () => {
    const head = await db.head();
    if (!head) return null;
    const snapshot = head.snapshotId ? await db.snapshots.get(head.snapshotId) : undefined;
    if (head.snapshotId && !snapshot) throw storageError('StorageUnavailable', 'The document snapshot is missing.');
    const journal = (await db.journal.where('ordinal').above(head.snapshotOrdinal).sortBy('ordinal')).map(({ id, payload }) => ({ id, payload }));
    return { ...head.checkpoint, payload: snapshot?.payload ?? new Uint8Array(), ...(journal.length ? { journal } : {}) };
  });
}

/** Pending membership and immutable delivery bytes are read in one transaction. */
async function pendingOutbox(db: DocumentDatabase) {
  const rows = await db.outbox.bulkGet((await db.pending.orderBy('ordinal').toArray()).map(row => row.id));
  if (rows.some(row => !row)) throw storageError('StorageUnavailable', 'Pending outbox evidence is missing.');
  return rows.map(row => ({ id: row!.id, revision: row!.revision, payload: row!.payload }));
}

/** Resolve only this request's immutable payloads; a retry never compares against a newer head. */
async function originalBatch(db: DocumentDatabase, receipt: ExactReceiptRow): Promise<DocumentCommitBatch> {
  const snapshot = receipt.snapshotId ? await db.snapshots.get(receipt.snapshotId) : undefined;
  const outbox: DocumentOutboxEntry[] = [];
  for (const id of receipt.outbox) {
    const entry = await db.outbox.get(id);
    if (!entry) throw storageError('StorageUnavailable', 'Immutable outbox evidence is missing.');
    outbox.push({ id, revision: entry.revision, payload: entry.payload });
  }
  let journal: DocumentJournalEntry[] | undefined;
  if (receipt.journal !== undefined) {
    journal = [];
    for (const id of receipt.journal) {
      const entry = await db.journal.get(id);
      if (!entry) throw storageError('StorageUnavailable', 'Immutable journal evidence is missing.');
      journal.push({ id, payload: entry.payload });
    }
  }
  if (receipt.snapshotId && !snapshot) throw storageError('StorageUnavailable', 'Immutable snapshot evidence is missing.');
  return { batchId: receipt.batchId, expectedRevision: receipt.expectedRevision,
    checkpoint: { ...receipt.checkpoint, payload: snapshot?.payload ?? new Uint8Array() },
    outbox, ...(journal === undefined ? {} : { journal }) };
}

/** Imported only by document.worker.ts (Node imports are test-only). One document owns one DB. */
export function createDocumentDatabase(options: DatabaseOptions = {}): DocumentStore & { dispose(): Promise<void> } {
  const owner = createDocumentOwner();
  const lock = options.acquireWriter ?? acquireWriter;
  let db: DocumentDatabase | undefined;
  let closing = false, opening = false;
  const database = (session: DocumentSession) => { owner.get(session); return db!; };
  return Object.freeze({
    async openSession(configuration: DocumentSessionOptions) {
      if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
      const key = documentKey(configuration);
      if (db || opening) throw storageError('StorageConflict', 'Document storage already has an active document.');
      opening = true;
      const alias = configuration.legacyDocumentId && configuration.legacyDocumentId !== configuration.documentId
        ? documentKey({ ...configuration, documentId: configuration.legacyDocumentId }) : undefined;
      const releases: (() => void)[] = [];
      let candidate: DocumentDatabase | undefined;
      const release = () => { for (const action of releases.splice(0).reverse()) action(); };
      try {
        // Both identities remain locked for the session, preventing an old writer from
        // modifying the migration source while the canonical identity is being edited.
        for (const identity of [...new Set([key, ...(alias ? [alias] : [])])].sort()) releases.push(await lock(identity));
        if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
        candidate = new DocumentDatabase(databaseName(options.databaseName, key));
        await candidate.open();
        await migrateDocument(candidate, options.databaseName, key, alias);
        if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
        const opened = candidate;
        const session = owner.add(configuration, () => { opened.close(); db = undefined; release(); });
        db = opened;
        return session;
      } catch (error) { candidate?.close(); release(); throw error; }
      finally { opening = false; }
    },
    async readCheckpoint(session: DocumentSession) { return readCheckpoint(database(session)); },
    async commitBatch(session: DocumentSession, value: DocumentCommitBatch) {
      const currentDb = database(session);
      const { batch }: { batch: DocumentCommitBatch } = await prepareBatch(value);
      owner.get(session);
      // V1 hashing uses WebCrypto outside a transaction. These immutable receipts are
      // already accepted; verification returns directly and cannot enqueue outbox bytes.
      const previous = await currentDb.receipts.get(batch.batchId);
      if (previous?.kind === 'legacy') {
        const source = await currentDb.meta.get('legacySource');
        const receipt = await checkLegacyReceipt(previous, batch, source?.key === 'legacySource' ? source : undefined);
        owner.get(session); return receipt;
      }
      return currentDb.transaction('rw', currentDb.tables, async () => {
        owner.get(session);
        const receipt = await currentDb.receipts.get(batch.batchId);
        if (receipt?.kind === 'exact') return checkReceipt(receipt, batch, await originalBatch(currentDb, receipt));
        const current = await currentDb.head();
        if ((current?.checkpoint.revision ?? null) !== batch.expectedRevision) throw storageError('StorageConflict', 'Checkpoint revision changed.');
        let nextOutboxOrdinal = current?.nextOutboxOrdinal ?? 0, nextJournalOrdinal = current?.nextJournalOrdinal ?? 0;
        for (const entry of batch.outbox) {
          const existing = await currentDb.outbox.get(entry.id);
          if (existing && !equalOutbox(existing, entry)) throw storageError('BatchConflict', 'Outbox identities cannot change.');
          if (!existing) {
            await currentDb.outbox.put(entry);
            await currentDb.pending.put({ id: entry.id, ordinal: nextOutboxOrdinal++ });
          }
        }
        for (const entry of batch.journal ?? []) {
          const existing = await currentDb.journal.get(entry.id);
          if (existing && !equalBytes(existing.payload, entry.payload)) throw storageError('BatchConflict', 'Journal identities cannot change.');
          if (!existing) await currentDb.journal.put({ ...entry, ordinal: nextJournalOrdinal++ });
        }
        const replacesSnapshot = batch.checkpoint.payload.length > 0;
        const snapshotId = replacesSnapshot ? JSON.stringify(['batch', batch.batchId]) : undefined;
        if (snapshotId) await currentDb.snapshots.put({ id: snapshotId, payload: batch.checkpoint.payload });
        const head: HeadRow = { key: 'head', checkpoint: checkpointMetadata(current?.checkpoint, batch.checkpoint),
          snapshotId: snapshotId ?? current?.snapshotId,
          snapshotOrdinal: replacesSnapshot ? nextJournalOrdinal - 1 : current?.snapshotOrdinal ?? -1,
          nextJournalOrdinal, nextOutboxOrdinal };
        await currentDb.meta.put(head);
        await currentDb.receipts.put({ kind: 'exact', batchId: batch.batchId, revision: batch.checkpoint.revision,
          expectedRevision: batch.expectedRevision, checkpoint: checkpointMetadata(undefined, batch.checkpoint),
          ...(snapshotId ? { snapshotId } : {}), outbox: batch.outbox.map(entry => entry.id),
          ...(batch.journal === undefined ? {} : { journal: batch.journal.map(entry => entry.id) }) });
        return { batchId: batch.batchId, revision: batch.checkpoint.revision };
      });
    },
    async acknowledgeOutbox(session: DocumentSession, ids: readonly string[]) {
      const currentDb = database(session), acknowledged = copyAcknowledgements(ids);
      await currentDb.pending.bulkDelete(acknowledged);
    },
    async readOutbox(session: DocumentSession) {
      const currentDb = database(session);
      return currentDb.transaction('r', currentDb.pending, currentDb.outbox, () => pendingOutbox(currentDb));
    },
    async readReplicationState(session: DocumentSession) {
      const currentDb = database(session);
      return currentDb.transaction('r', currentDb.meta, currentDb.pending, currentDb.outbox, async () => ({
        clock: (await currentDb.head())?.checkpoint.clock ?? {},
        outbox: (await pendingOutbox(currentDb)).map(({ id, payload }) => ({ id, payload })),
      }));
    },
    async closeSession(session: DocumentSession) { owner.close(session); },
    async deleteDocument(session: DocumentSession) {
      const currentDb = database(session);
      await currentDb.transaction('rw', currentDb.tables, async () => {
        // Keep the migration marker so deletion cannot revive legacy pending bytes on reopen.
        await currentDb.meta.delete('head');
        await currentDb.meta.delete('legacySource');
        for (const table of [currentDb.snapshots, currentDb.journal, currentDb.outbox, currentDb.pending, currentDb.receipts]) await table.clear();
      });
    },
    async dispose() { closing = true; owner.dispose(); db?.close(); },
  });
}
