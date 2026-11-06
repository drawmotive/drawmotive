import Dexie, { type Table } from 'dexie';
import type { DocumentCheckpoint, DocumentOutboxEntry } from '../document-store.js';

/** A document's mutable head contains only small replica metadata and immutable-log offsets. */
export interface HeadRow {
  key: 'head';
  checkpoint: Omit<DocumentCheckpoint, 'payload' | 'journal'>;
  snapshotId?: string;
  snapshotOrdinal: number;
  nextJournalOrdinal: number;
  nextOutboxOrdinal: number;
}
export interface MigrationRow { key: 'migration'; complete: true; }
/** One source reference per document suffices for all migrated hash-only receipts. */
export interface LegacySourceRow { key: 'legacySource'; databaseName: string; sourceKey: string; }
/** Snapshots and journal payloads remain immutable so historical receipts can compare exact bytes. */
export interface PayloadRow { id: string; payload: Uint8Array; }
export interface JournalRow extends PayloadRow { ordinal: number; }
/** Payload identity survives ACKs; pending membership is stored separately without rewriting bytes. */
export interface OutboxRow extends DocumentOutboxEntry {}
export interface PendingRow { id: string; ordinal: number; }
/** Receipts reference immutable payload rows instead of persisting another copy of each transaction. */
export interface ExactReceiptRow {
  kind: 'exact'; batchId: string; revision: string; expectedRevision: string | null;
  checkpoint: Omit<DocumentCheckpoint, 'payload' | 'journal'>;
  snapshotId?: string;
  outbox: string[];
  journal?: string[];
}
/** V1 never retained original requests; the unchanged source is its only retry evidence. */
export interface LegacyReceiptRow {
  kind: 'legacy'; batchId: string; revision: string;
}
export type ReceiptRow = ExactReceiptRow | LegacyReceiptRow;

/** Full encoded identities avoid hash collisions and keep account/document keys out of every row. */
export function databaseName(prefix: string | undefined, key: string): string {
  return (prefix ?? 'drawmotive-documents') + ':document-v2:' + encodeURIComponent(key);
}

/** Private per-document schema. The document Worker is its sole production owner. */
export class DocumentDatabase extends Dexie {
  readonly meta: Table<HeadRow | MigrationRow | LegacySourceRow, string>;
  readonly snapshots: Table<PayloadRow, string>;
  readonly journal: Table<JournalRow, string>;
  readonly outbox: Table<OutboxRow, string>;
  readonly pending: Table<PendingRow, string>;
  readonly receipts: Table<ReceiptRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ meta: 'key', snapshots: 'id', journal: 'id, &ordinal', outbox: 'id', pending: 'id, &ordinal', receipts: 'batchId' });
    this.meta = this.table('meta'); this.snapshots = this.table('snapshots'); this.journal = this.table('journal');
    this.outbox = this.table('outbox'); this.receipts = this.table('receipts');
    this.pending = this.table('pending');
  }
  async head(): Promise<HeadRow | undefined> { return await this.meta.get('head') as HeadRow | undefined; }
}
