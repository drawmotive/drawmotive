import Dexie, { type Table } from 'dexie';
import type { DocumentCheckpoint, DocumentOutboxEntry, DocumentImageAsset } from '../document-store.js';

/** A document's mutable head contains only small replica metadata and immutable-log offsets. */
export interface HeadRow {
  key: 'head';
  checkpoint: Omit<DocumentCheckpoint, 'payload' | 'journal'>;
  snapshotId?: string;
  snapshotOrdinal: number;
  nextJournalOrdinal: number;
  nextOutboxOrdinal: number;
}
/** One replaceable opaque snapshot is separate from the immutable original journal. */
export interface PayloadRow { id: string; payload: Uint8Array; }
export interface JournalRow extends PayloadRow { ordinal: number; }
/** Payload identity survives ACKs; pending membership is stored separately without rewriting bytes. */
export interface OutboxRow extends DocumentOutboxEntry {}
export interface PendingRow { id: string; ordinal: number; }
/** SHA-256 attests the complete original batch without retaining retired snapshot bytes. */
export interface BatchReceiptRow {
  batchId: string; revision: string; digest: string;
}
/** A fixed fresh generation never imports previous formats. Full encoded identities
 * avoid hash collisions and keep account/document keys out of every row. */
export function databaseName(prefix: string | undefined, key: string): string {
  return (prefix ?? 'drawmotive-documents') + ':document-v4:' + encodeURIComponent(key);
}

/** Private per-document schema. The document Worker is its sole production owner. */
export class DocumentDatabase extends Dexie {
  readonly meta: Table<HeadRow, string>;
  readonly snapshots: Table<PayloadRow, string>;
  readonly journal: Table<JournalRow, string>;
  readonly outbox: Table<OutboxRow, string>;
  readonly assets: Table<DocumentImageAsset, string>;
  readonly pending: Table<PendingRow, string>;
  readonly receipts: Table<BatchReceiptRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ meta: 'key', snapshots: 'id', journal: 'id, &ordinal', outbox: 'id', pending: 'id, &ordinal', receipts: 'batchId' });
    this.version(2).stores({ assets: 'hash' });
    this.assets = this.table('assets');
    this.meta = this.table('meta'); this.snapshots = this.table('snapshots'); this.journal = this.table('journal');
    this.outbox = this.table('outbox'); this.receipts = this.table('receipts');
    this.pending = this.table('pending');
  }
  async head(): Promise<HeadRow | undefined> { return await this.meta.get('head'); }
}
