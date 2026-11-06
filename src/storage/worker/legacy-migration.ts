import Dexie from 'dexie';
import type { DocumentCheckpoint, DocumentCommitBatch } from '../document-store.js';
import { checkpointMetadata, storageError } from '../store-operations.js';
import { databaseName, DocumentDatabase, type HeadRow, type LegacyReceiptRow, type LegacySourceRow } from './schema.ts';

type MigrationData = Record<string, unknown[]>;

async function readPreviousDatabase(name: string): Promise<MigrationData | undefined> {
  if (!await Dexie.exists(name)) return undefined;
  const source = new DocumentDatabase(name);
  try {
    await source.open();
    return await source.transaction('r', source.tables, async () => {
      const entries: [string, unknown[]][] = [];
      for (const table of source.tables) entries.push([table.name, await table.toArray()]);
      return Object.fromEntries(entries);
    });
  } finally { source.close(); }
}

async function readSharedDatabase(name: string, keys: string[]): Promise<MigrationData | undefined> {
  if (!await Dexie.exists(name)) return undefined;
  const source = new Dexie(name);
  try {
    await source.open();
    return await source.transaction('r', source.tables, async () => {
      for (const key of keys) {
        const document = await source.table<{ checkpoint: DocumentCheckpoint; nextOrdinal: number }>('documents').get(key);
        if (!document) continue;
        const pending = await source.table('outbox').where('documentKey').equals(key).sortBy('ordinal');
        const receipts = await source.table('receipts').where('documentKey').equals(key).toArray();
        const snapshotId = 'legacy';
        const head: HeadRow = { key: 'head', checkpoint: checkpointMetadata(undefined, document.checkpoint),
          snapshotId, snapshotOrdinal: -1, nextJournalOrdinal: 0, nextOutboxOrdinal: document.nextOrdinal };
        return {
          meta: [head, { key: 'legacySource', databaseName: name, sourceKey: key }],
          snapshots: [{ id: snapshotId, payload: document.checkpoint.payload }], journal: [],
          outbox: pending.map(({ id, revision, payload }) => ({ id, revision, payload })),
          pending: pending.map(({ id, ordinal }) => ({ id, ordinal })),
          receipts: receipts.map(({ batchId, revision }) => ({ kind: 'legacy', batchId, revision })),
        };
      }
      return undefined;
    });
  } finally { source.close(); }
}

/** Both canonical and explicit alias writer leases must be held before reading recovery sources.
 * Copy once atomically, leave sources unchanged, and persist the marker even for empty/deleted data.
 * Reopening or explicit deletion must never import old pending records again. */
export async function migrateDocument(target: DocumentDatabase, prefix: string | undefined, key: string, alias?: string): Promise<void> {
  if (await target.meta.get('migration')) return;
  // An existing canonical identity owns the data even when an older alias source remains.
  const sharedName = prefix ?? 'drawmotive-documents-v1';
  const data = await readSharedDatabase(sharedName, [key]) ??
    (alias ? await readPreviousDatabase(databaseName(prefix, alias)) ?? await readSharedDatabase(sharedName, [alias]) : undefined);
  await target.transaction('rw', target.tables, async () => {
    if (await target.meta.get('migration')) return;
    if (data) for (const table of target.tables) {
      const rows = data[table.name];
      if (rows?.length) await table.bulkPut(rows);
    }
    await target.meta.put({ key: 'migration', complete: true });
  });
}

/** Only already-accepted V1 requests use their old hash. V1 discarded their original bytes;
 * all new receipts retain exact immutable evidence and never create another fingerprint. */
export async function checkLegacyReceipt(receipt: LegacyReceiptRow, batch: DocumentCommitBatch, recovery: LegacySourceRow | undefined) {
  if (batch.checkpoint.state !== undefined || batch.journal !== undefined)
    throw storageError('BatchConflict', 'A legacy batch cannot acquire new fields.');
  if (!recovery || !await Dexie.exists(recovery.databaseName))
    throw storageError('StorageUnavailable', 'The legacy receipt recovery source is unavailable.');
  const source = new Dexie(recovery.databaseName);
  let original;
  try {
    await source.open();
    original = await source.table('receipts').get([recovery.sourceKey, receipt.batchId]);
  } finally { source.close(); }
  if (!original) throw storageError('StorageUnavailable', 'The legacy receipt recovery source is unavailable.');
  const metadata = new TextEncoder().encode(JSON.stringify([batch.batchId, batch.expectedRevision,
    batch.checkpoint.revision, Object.entries(batch.checkpoint.clock).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    batch.checkpoint.payload.length, batch.outbox.map(entry => [entry.id, entry.revision, entry.payload.length])]));
  const arrays = [metadata, batch.checkpoint.payload, ...batch.outbox.map(entry => entry.payload)];
  const joined = new Uint8Array(arrays.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of arrays) { joined.set(part, offset); offset += part.length; }
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', joined))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (original.fingerprint !== digest) throw storageError('BatchConflict', 'A batch ID cannot refer to different content.');
  return { batchId: receipt.batchId, revision: receipt.revision };
}
