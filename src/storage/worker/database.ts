import type { DocumentCheckpoint, DocumentSession, DocumentSessionOptions, DocumentStore, DocumentCommitBatch } from '../document-store.js';
import { createDocumentOwner, prepareBatch, storageError, checkImmutableRecord, checkReceipt, documentKey, copyAcknowledgements, checkpointMetadata, snapshotCut, isOriginJournalId } from '../store-operations.js';
import { databaseName, DocumentDatabase, type HeadRow } from './schema.ts';

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
    const journal = (await db.journal.where('ordinal').above(head.snapshotOrdinal).sortBy('ordinal'))
      .filter(({ id }) => !isOriginJournalId(id)).map(({ id, payload }) => ({ id, payload }));
    return { ...head.checkpoint, payload: snapshot?.payload ?? new Uint8Array(), ...(journal.length ? { journal } : {}) };
  });
}

/** Pending membership and immutable delivery bytes are read in one transaction. */
async function pendingOutbox(db: DocumentDatabase) {
  const rows = await db.outbox.bulkGet((await db.pending.orderBy('ordinal').toArray()).map(row => row.id));
  if (rows.some(row => !row)) throw storageError('StorageUnavailable', 'Pending outbox evidence is missing.');
  return rows.map(row => ({ id: row!.id, revision: row!.revision, payload: row!.payload }));
}

/** Digest matches do not excuse missing or changed immutable transaction evidence. */
async function batchRecords(db: DocumentDatabase, batch: DocumentCommitBatch, receipt = false) {
  const journal = batch.journal ?? [];
  const [storedOutbox, storedJournal] = await Promise.all([
    db.outbox.bulkGet(batch.outbox.map(entry => entry.id)), db.journal.bulkGet(journal.map(entry => entry.id)),
  ]);
  batch.outbox.forEach((entry, index) => checkImmutableRecord(storedOutbox[index], entry, 'outbox', receipt));
  journal.forEach((entry, index) => checkImmutableRecord(storedJournal[index], entry, 'journal', receipt));
  return { outbox: batch.outbox.filter((_, index) => !storedOutbox[index]), journal: journal.filter((_, index) => !storedJournal[index]) };
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
      let release: (() => void) | undefined;
      let candidate: DocumentDatabase | undefined;
      try {
        release = await lock(key);
        if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
        candidate = new DocumentDatabase(databaseName(options.databaseName, key));
        await candidate.open();
        if (closing) throw storageError('EditorDisposed', 'Document storage is closing.');
        const opened = candidate;
        const session = owner.add(configuration, () => { opened.close(); db = undefined; release?.(); });
        db = opened;
        return session;
      } catch (error) { candidate?.close(); release?.(); throw error; }
      finally { opening = false; }
    },
    async readCheckpoint(session: DocumentSession) { return readCheckpoint(database(session)); },
    async readRetainedJournal(session: DocumentSession) {
      const currentDb = database(session);
      return currentDb.transaction('r', currentDb.meta, currentDb.journal, async () => {
        const head = await currentDb.head();
        return { revision: head?.checkpoint.revision ?? null, clock: head?.checkpoint.clock ?? {},
          journal: (await currentDb.journal.orderBy('ordinal').toArray()).map(({ id, payload }) => ({ id, payload })) };
      });
    },
    async commitBatch(session: DocumentSession, value: DocumentCommitBatch) {
      const currentDb = database(session);
      const { batch, digest }: { batch: DocumentCommitBatch; digest: string } = await prepareBatch(value);
      owner.get(session);
      return currentDb.transaction('rw', currentDb.tables, async () => {
        owner.get(session);
        const receipt = await currentDb.receipts.get(batch.batchId);
        if (receipt) {
          const confirmed = checkReceipt(receipt, digest);
          await batchRecords(currentDb, batch, true);
          return confirmed;
        }
        const current = await currentDb.head();
        if ((current?.checkpoint.revision ?? null) !== batch.expectedRevision) throw storageError('StorageConflict', 'Checkpoint revision changed.');
        let nextOutboxOrdinal = current?.nextOutboxOrdinal ?? 0, nextJournalOrdinal = current?.nextJournalOrdinal ?? 0;
        const records = await batchRecords(currentDb, batch);
        for (const entry of records.outbox) {
          await currentDb.outbox.put(entry);
          await currentDb.pending.put({ id: entry.id, ordinal: nextOutboxOrdinal++ });
        }
        for (const entry of records.journal) {
          await currentDb.journal.put({ ...entry, ordinal: nextJournalOrdinal++ });
        }
        const replacesSnapshot = batch.checkpoint.payload.length > 0;
        const boundary = replacesSnapshot && batch.checkpoint.snapshotAfterJournalId !== null
          ? await currentDb.journal.get(batch.checkpoint.snapshotAfterJournalId!) : undefined;
        const snapshotOrdinal = snapshotCut(current?.snapshotOrdinal, batch.checkpoint, boundary?.ordinal);
        const snapshotId = replacesSnapshot ? 'current' : undefined;
        if (snapshotId) await currentDb.snapshots.put({ id: snapshotId, payload: batch.checkpoint.payload });
        const head: HeadRow = { key: 'head', checkpoint: checkpointMetadata(current?.checkpoint, batch.checkpoint),
          snapshotId: snapshotId ?? current?.snapshotId,
          snapshotOrdinal,
          nextJournalOrdinal, nextOutboxOrdinal };
        await currentDb.meta.put(head);
        await currentDb.receipts.put({ batchId: batch.batchId, revision: batch.checkpoint.revision, digest });
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
      return currentDb.transaction('r', currentDb.meta, currentDb.pending, currentDb.outbox, async () => {
        const head = await currentDb.head();
        return { clock: head?.checkpoint.clock ?? {}, snapshotKey: head?.checkpoint.snapshotAfterJournalId ?? 'origin',
          outbox: (await pendingOutbox(currentDb)).map(({ id, payload }) => ({ id, payload })) };
      });
    },
    async closeSession(session: DocumentSession) { owner.close(session); },
    async deleteDocument(session: DocumentSession) {
      const currentDb = database(session);
      await currentDb.transaction('rw', currentDb.tables, async () => {
        for (const table of currentDb.tables) await table.clear();
      });
    },
    async dispose() { closing = true; owner.dispose(); db?.close(); },
  });
}
