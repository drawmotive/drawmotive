export const storageError = (code, message) => Object.assign(new Error(message), { code });
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;

export function documentKey(options) {
  if (!options || !['namespace', 'documentId', 'instanceId', 'documentSessionId'].every(key => id(options[key])) ||
      !['persistent', 'memory'].includes(options.persistence))
    throw storageError('InvalidDocumentSession', 'A namespace, document and unique session identity are required.');
  return JSON.stringify([options.namespace, options.documentId]);
}
export function sessionRegistry() {
  const sessions = new Map(), owners = new Map();
  let disposed = false;
  return {
    add(options, release = () => {}) {
      if (disposed) throw storageError('EditorDisposed', 'Document store is disposed.');
      const key = documentKey(options);
      if (owners.has(key)) throw storageError('StorageConflict', 'The document already has an active writer.');
      if (sessions.has(options.documentSessionId)) throw storageError('InvalidDocumentSession', 'Document session IDs cannot be reused.');
      const session = Object.freeze({ ...options, leaseId: crypto.randomUUID() });
      sessions.set(session.documentSessionId, { session, key, release }); owners.set(key, session.documentSessionId);
      return session;
    },
    get(session) {
      const record = sessions.get(session?.documentSessionId);
      if (disposed || !record || ['instanceId', 'namespace', 'documentId', 'documentSessionId', 'leaseId', 'persistence'].some(key => record.session[key] !== session[key]))
        throw storageError('StaleDocumentSession', 'This document session is no longer active.');
      return record;
    },
    close(session) {
      const record = this.get(session);
      sessions.delete(session.documentSessionId); owners.delete(record.key); record.release();
    },
    dispose() {
      disposed = true;
      for (const record of sessions.values()) record.release();
      sessions.clear(); owners.clear();
    },
  };
}
export async function prepareBatch(value) {
  // Clone before the first await: callers cannot mutate an in-flight database commit.
  const batch = structuredClone(value);
  if (!batch || !id(batch.batchId) || !(batch.expectedRevision === null || id(batch.expectedRevision)) ||
      !id(batch.checkpoint?.revision) || !(batch.checkpoint.payload instanceof Uint8Array) ||
      !Array.isArray(batch.outbox) || batch.outbox.some(entry => !id(entry.id) || !id(entry.revision) || !(entry.payload instanceof Uint8Array)) ||
      new Set(batch.outbox.map(entry => entry.id)).size !== batch.outbox.length)
    throw storageError('InvalidCommitBatch', 'A complete checkpoint and distinct outbox records are required.');
  // structuredClone retains SharedArrayBuffer memory and oversized view backing
  // buffers. Persist compact, independently owned ordinary ArrayBuffers instead.
  batch.checkpoint.payload = new Uint8Array(batch.checkpoint.payload);
  for (const entry of batch.outbox) entry.payload = new Uint8Array(entry.payload);
  const metadata = new TextEncoder().encode(JSON.stringify([batch.batchId, batch.expectedRevision,
    batch.checkpoint.revision, batch.checkpoint.payload.length, batch.outbox.map(entry => [entry.id, entry.revision, entry.payload.length])]));
  const arrays = [metadata, batch.checkpoint.payload, ...batch.outbox.map(entry => entry.payload)];
  const joined = new Uint8Array(arrays.reduce((length, part) => length + part.length, 0));
  let offset = 0; for (const part of arrays) { joined.set(part, offset); offset += part.length; }
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', joined)), byte => byte.toString(16).padStart(2, '0')).join('');
  return { batch, fingerprint };
}
export function copyAcknowledgements(ids) {
  if (!Array.isArray(ids) || ids.some(value => !id(value)))
    throw storageError('InvalidAcknowledgement', 'Acknowledgements require explicit operation IDs.');
  return [...ids];
}
export function equalOutbox(left, right) {
  return left.revision === right.revision && left.payload.length === right.payload.length &&
    left.payload.every((byte, index) => byte === right.payload[index]);
}
export function checkReceipt(receipt, fingerprint) {
  if (receipt.fingerprint !== fingerprint) throw storageError('BatchConflict', 'A batch ID cannot refer to different content.');
  return { batchId: receipt.batchId, revision: receipt.revision };
}
