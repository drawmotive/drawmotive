export const storageError = (code, message) => Object.assign(new Error(message), { code });
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;
const validClock = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.entries(value).every(([author, sequence]) => id(author) && Number.isInteger(sequence) && sequence >= 0 && sequence <= 2147483647);

export function documentKey(options) {
  if (!options || !['namespace', 'documentId'].every(key => id(options[key])) ||
      !['persistent', 'memory'].includes(options.persistence) ||
      Object.keys(options).some(key => !['namespace', 'documentId', 'persistence'].includes(key)))
    throw storageError('InvalidDocumentSession', 'A namespace, document and persistence mode are required.');
  return JSON.stringify([options.namespace, options.documentId]);
}
/** A store owns one active document. A fresh lease rejects callbacks from a closed document. */
export function createDocumentOwner() {
  let owner, disposed = false;
  return {
    add(options, release = () => {}) {
      if (disposed) throw storageError('EditorDisposed', 'Document store is disposed.');
      const key = documentKey(options);
      if (owner) throw storageError('StorageConflict', 'Document storage already has an active document.');
      const session = Object.freeze({ namespace: options.namespace, documentId: options.documentId,
        persistence: options.persistence, leaseId: crypto.randomUUID() });
      owner = { session, key, release };
      return session;
    },
    get(session) {
      if (disposed || !owner || !session || ['namespace', 'documentId', 'leaseId', 'persistence'].some(key => owner.session[key] !== session[key]))
        throw storageError('StaleDocumentSession', 'This document session is no longer active.');
      return owner;
    },
    close(session) {
      const record = this.get(session);
      owner = undefined; record.release();
    },
    dispose() {
      disposed = true;
      const record = owner; owner = undefined; record?.release();
    },
  };
}
/** Copy and validate before yielding; every retained byte belongs exclusively to storage. */
export async function prepareBatch(value) {
  const batch = structuredClone(value);
  // .NET interop emits null for omitted optional fields. Canonicalize it before
  // validation/equality; the checkpoint journal is an output-only replay suffix.
  if (batch?.checkpoint?.state === null) delete batch.checkpoint.state;
  if (batch?.journal === null) delete batch.journal;
  if (batch?.checkpoint) delete batch.checkpoint.journal;
  const validEntries = entries => Array.isArray(entries) && entries.every(entry => id(entry?.id) && entry.payload instanceof Uint8Array) &&
    new Set(entries.map(entry => entry.id)).size === entries.length;
  if (!batch || !id(batch.batchId) || !(batch.expectedRevision === null || id(batch.expectedRevision)) ||
      !id(batch.checkpoint?.revision) || !(batch.checkpoint.payload instanceof Uint8Array) || !validClock(batch.checkpoint.clock) ||
      batch.checkpoint.state !== undefined && !(batch.checkpoint.state instanceof Uint8Array) ||
      !validEntries(batch.outbox) || batch.outbox.some(entry => !id(entry.revision)) ||
      batch.journal !== undefined && !validEntries(batch.journal))
    throw storageError('InvalidCommitBatch', 'A complete checkpoint and distinct immutable records are required.');
  // SharedArrayBuffer and oversized views must become compact ordinary buffers.
  batch.checkpoint.payload = new Uint8Array(batch.checkpoint.payload);
  if (batch.checkpoint.state !== undefined) batch.checkpoint.state = new Uint8Array(batch.checkpoint.state);
  for (const entry of [...batch.outbox, ...(batch.journal ?? [])]) entry.payload = new Uint8Array(entry.payload);
  return { batch };
}
export function copyAcknowledgements(ids) {
  if (!Array.isArray(ids) || ids.some(value => !id(value)))
    throw storageError('InvalidAcknowledgement', 'Acknowledgements require explicit operation IDs.');
  return [...ids];
}
export function equalBytes(left, right) {
  return left === undefined || right === undefined ? left === right : left.length === right.length &&
    left.every((byte, index) => byte === right[index]);
}
export function equalOutbox(left, right) {
  return left.revision === right.revision && equalBytes(left.payload, right.payload);
}
/** Equality covers the original request, rather than a digest or the latest mutable head. */
export function equalBatch(left, right) {
  const entriesEqual = (a, b, outbox = false) => a === undefined || b === undefined ? a === b :
    a.length === b.length && a.every((entry, index) => entry.id === b[index].id &&
      (!outbox || entry.revision === b[index].revision) && equalBytes(entry.payload, b[index].payload));
  const a = left.checkpoint, b = right.checkpoint;
  return left.batchId === right.batchId && left.expectedRevision === right.expectedRevision && a.revision === b.revision &&
    equalBytes(a.payload, b.payload) && equalBytes(a.state, b.state) &&
    Object.keys(a.clock).length === Object.keys(b.clock).length && Object.entries(a.clock).every(([key, value]) => b.clock[key] === value) &&
    entriesEqual(left.outbox, right.outbox, true) && entriesEqual(left.journal, right.journal);
}
export function checkReceipt(receipt, batch, original = receipt.batch) {
  if (!equalBatch(original, batch)) throw storageError('BatchConflict', 'A batch ID cannot refer to different content.');
  return { batchId: receipt.batchId, revision: receipt.revision };
}
/** Empty payloads append to the existing snapshot; only a replacing snapshot clears omitted state. */
export function checkpointMetadata(previous, checkpoint) {
  const { revision, clock } = checkpoint;
  const state = checkpoint.state ?? (checkpoint.payload.length === 0 ? previous?.state : undefined);
  return { revision, clock, ...(state === undefined ? {} : { state }) };
}
