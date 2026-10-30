/** Logical document persistence only. Database names, tables and row operations are private. */
export type DocumentPersistenceMode = 'memory' | 'persistent';
export interface DocumentSession {
  readonly instanceId: string;
  /** Opaque App/account namespace; never inferred from a document ID or a token. */
  readonly namespace: string;
  readonly documentId: string;
  readonly documentSessionId: string;
  /** Worker-issued ownership token. Every operation must reject an expired lease. */
  readonly leaseId: string;
  readonly persistence: DocumentPersistenceMode;
}
export interface DocumentSessionOptions {
  instanceId: string;
  namespace: string;
  documentId: string;
  documentSessionId: string;
  persistence: DocumentPersistenceMode;
}
/** An opaque engine checkpoint contains object state, transactions, clock and history. */
export interface DocumentCheckpoint {
  readonly revision: string;
  readonly payload: Uint8Array;
}
export interface DocumentOutboxEntry {
  readonly id: string;
  readonly revision: string;
  readonly payload: Uint8Array;
}
/** Checkpoint, new outbox entries and the durable batch receipt commit atomically.
 * Objects, transactions, clock and undo/redo history remain one engine checkpoint.
 * expectedRevision mismatches reject without writing any part. A repeated batchId
 * with identical content returns its original receipt; different content rejects. */
export interface DocumentCommitBatch {
  readonly batchId: string;
  readonly expectedRevision: string | null;
  readonly checkpoint: DocumentCheckpoint;
  /** New entries only, upserted by stable operation ID. This is not a full replacement.
   * Batch replay must not recreate entries removed by a transport acknowledgement. */
  readonly outbox: readonly DocumentOutboxEntry[];
}
export interface DocumentCommitReceipt {
  readonly batchId: string;
  readonly revision: string;
}
/** A Dedicated Worker owns this boundary; no IndexedDB access occurs on the UI thread.
 * Storage identity is namespace + documentId. Exactly one writer lease may own that
 * pair at a time; opening a competing session must reject with StorageConflict.
 * Every operation verifies the namespace, document session and current lease. */
export interface DocumentStore {
  openSession(options: DocumentSessionOptions): Promise<DocumentSession>;
  readCheckpoint(session: DocumentSession): Promise<DocumentCheckpoint | null>;
  commitBatch(session: DocumentSession, batch: DocumentCommitBatch): Promise<DocumentCommitReceipt>;
  /** Atomically removes only the named entries; does not rewrite a checkpoint. */
  acknowledgeOutbox(session: DocumentSession, ids: readonly string[]): Promise<void>;
  readOutbox(session: DocumentSession): Promise<readonly DocumentOutboxEntry[]>;
  /** Closes ownership. Persistent documents remain; memory sessions may release their data. */
  closeSession(session: DocumentSession): Promise<void>;
  /** Deletion is explicit and is never implied by editor disposal or closeSession. */
  deleteDocument(session: DocumentSession): Promise<void>;
}

/** Font assets have a separate resource worker and never enter a document batch.
 * Paths are normalized stable resource paths; sha256 is metadata, never a filename. */
export interface FontResourceRequest {
  readonly path: string;
  readonly url: string;
  readonly sha256: string;
  readonly byteLength?: number;
}
export interface FontResourceResult {
  readonly bytes: Uint8Array;
  readonly cache: 'hit' | 'stored' | 'unavailable' | 'write-failed';
  readonly detail?: string;
}
/** The resource worker verifies sha256 before returning cached or downloaded bytes.
 * OPFS uses stable paths plus SHA256 metadata; CacheStorage is not a cache backend. */
export interface FontResourceLoader {
  load(resource: FontResourceRequest): Promise<FontResourceResult>;
  /** Idempotent. Releases worker ownership without deleting cached font resources. */
  dispose(): Promise<void>;
}
