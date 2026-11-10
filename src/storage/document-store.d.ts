/** Logical document persistence only. Database names, tables and row operations are private. */
export type DocumentPersistenceMode = 'memory' | 'persistent';
export interface DocumentSession {
  /** Opaque App/account namespace; never inferred from a document ID or a token. */
  readonly namespace: string;
  readonly documentId: string;
  /** Worker-issued ownership token. Every operation must reject an expired lease. */
  readonly leaseId: string;
  readonly persistence: DocumentPersistenceMode;
}
export interface DocumentSessionOptions {
  namespace: string;
  documentId: string;
  persistence: DocumentPersistenceMode;
}
/** One opaque native checkpoint plus the latest engine replica metadata.
 * Native owns its two normalized scenes and bounded undo history; storage never nests snapshots. */
export interface DocumentCheckpoint {
  readonly revision: string;
  readonly payload: Uint8Array;
  /** Required on nonempty writes: last included original journal ID, or null before the log.
   * Reads return the active snapshot cut. Empty append writes omit it (interop null is normalized). */
  readonly snapshotAfterJournalId?: string | null;
  /** Engine-supplied delivery metadata, committed atomically with the opaque payload. */
  readonly clock: Readonly<Record<string, number>>;
  /** Small engine metadata. Omission retains it on append and clears it on snapshot replacement. */
  readonly state?: Uint8Array;
  /** Read result only: ordered immutable transactions accepted after the returned snapshot. */
  readonly journal?: readonly DocumentJournalEntry[];
}
/** Stable identity and original native bytes. Reserved $origin:<32 lower hex guid>
 * records archive noncausal scene origins; they never enter replay suffixes or delivery. */
export interface DocumentJournalEntry {
  readonly id: string;
  readonly payload: Uint8Array;
}
export interface DocumentOutboxEntry {
  readonly id: string;
  readonly revision: string;
  readonly payload: Uint8Array;
}
/** Canonical immutable PNG bytes; identity and access remain document scoped. */
export interface DocumentImageAsset { readonly hash: string; readonly data: Uint8Array; }
/** Snapshot/metadata, journal, outbox, image resources and the durable batch receipt commit atomically.
 * An empty checkpoint payload retains the previous snapshot and appends the journal.
 * A nonempty payload replaces the single opaque blob at its explicit journal cut;
 * later entries from the same batch remain in the replay suffix.
 * expectedRevision mismatches reject without writing any part. A repeated batchId
 * with the same SHA-256 canonical byte identity returns its original receipt;
 * different content rejects without retaining historical snapshot payloads. */
export interface DocumentCommitBatch {
  readonly batchId: string;
  readonly expectedRevision: string | null;
  readonly checkpoint: DocumentCheckpoint;
  /** New entries only, upserted by stable operation ID. This is not a full replacement.
   * Batch replay must not recreate entries removed by a transport acknowledgement. */
  readonly outbox: readonly DocumentOutboxEntry[];
  /** New immutable transactions only; existing IDs must retain exactly the same bytes. */
  readonly journal?: readonly DocumentJournalEntry[];
  /** New resources commit atomically with every referencing journal/outbox record. */
  readonly assets?: readonly DocumentImageAsset[];
}
export interface DocumentCommitReceipt {
  readonly batchId: string;
  readonly revision: string;
}
export interface DocumentDeliveryState {
  readonly clock: Readonly<Record<string, number>>;
  readonly outbox: readonly { readonly id: string; readonly payload: Uint8Array }[];
  /** Periodic native snapshot cut, stable across ordinary journal-only edits. */
  readonly snapshotKey: string;
}
/** One atomic read of the entire immutable archive, including acknowledged records and origins. */
export interface DocumentRetainedJournal {
  readonly revision: string | null;
  readonly clock: Readonly<Record<string, number>>;
  readonly journal: readonly DocumentJournalEntry[];
}
/** A Dedicated Worker owns this boundary; no IndexedDB access occurs on the UI thread.
 * Storage identity is namespace + documentId. Only one document may be open in a
 * store; opening a competing document rejects with StorageConflict. Every
 * operation verifies the namespace, document and current lease. */
export interface DocumentStore {
  openSession(options: DocumentSessionOptions): Promise<DocumentSession>;
  readCheckpoint(session: DocumentSession): Promise<DocumentCheckpoint | null>;
  readRetainedJournal(session: DocumentSession): Promise<DocumentRetainedJournal>;
  readAssets(session: DocumentSession, hashes?: readonly string[] | null): Promise<DocumentImageAsset[]>;
  /** Immutable persistence only; no revision, clock or history changes. */
  writeAssets(session: DocumentSession, assets: readonly DocumentImageAsset[]): Promise<void>;
  commitBatch(session: DocumentSession, batch: DocumentCommitBatch): Promise<DocumentCommitReceipt>;
  /** Atomically removes only the named entries; does not rewrite a checkpoint. */
  acknowledgeOutbox(session: DocumentSession, ids: readonly string[]): Promise<void>;
  readOutbox(session: DocumentSession): Promise<readonly DocumentOutboxEntry[]>;
  /** One atomic read of the durable clock and pending records; never reads engine memory. */
  readReplicationState(session: DocumentSession): Promise<DocumentDeliveryState>;
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
