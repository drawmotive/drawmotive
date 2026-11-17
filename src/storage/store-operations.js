export const storageError = (code, message) => Object.assign(new Error(message), { code });
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;
const validClock = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.entries(value).every(([author, sequence]) => id(author) && Number.isInteger(sequence) && sequence >= 0 && sequence <= 2147483647);
const clockAt = (value, author) => value && Object.hasOwn(value, author) ? value[author] : 0;
export const isOriginJournalId = value => typeof value === 'string' && /^\$origin:[0-9a-f]{32}$/.test(value);
const reservedOrigin = value => typeof value === 'string' && value.startsWith('$origin:');
export const validAssetHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function copyAssetHashes(hashes) {
  if (hashes == null) return undefined;
  if (!Array.isArray(hashes) || hashes.some(hash => !validAssetHash(hash)))
    throw storageError('InvalidImageAsset', 'Image assets require canonical SHA-256 identities.');
  return [...new Set(hashes)];
}
/** Image resources are mandatory immutable document evidence, independent of render caches. */
export async function prepareAssets(value) {
  if (!Array.isArray(value) || value.some(asset => !validAssetHash(asset?.hash) || !(asset.data instanceof Uint8Array) ||
      !asset.data.length || asset.data.length > 4_000_000) || new Set(value.map(asset => asset.hash)).size !== value.length)
    throw storageError('InvalidImageAsset', 'Distinct image assets require bounded bytes and canonical SHA-256 identities.');
  const assets = value.map(({hash,data}) => ({hash,data:new Uint8Array(data)}));
  for (const asset of assets) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', asset.data)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== asset.hash) throw storageError('InvalidImageAsset', 'Image bytes do not match their SHA-256 identity.');
  }
  return assets;
}
export function checkImmutableAsset(existing, asset, receipt = false) {
  const equal = existing && equalBytes(existing.data, asset.data);
  if (receipt && !equal) throw storageError('StorageUnavailable', 'Immutable image asset evidence is missing or changed.');
  if (existing && !equal) throw storageError('BatchConflict', 'Image asset identities cannot change.');
}

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
  if (batch?.checkpoint?.payload?.length === 0 && batch.checkpoint.snapshotAfterJournalId === null) delete batch.checkpoint.snapshotAfterJournalId;
  if (batch?.journal === null) delete batch.journal;
  if (batch?.assets === null) delete batch.assets;
  for (const field of ['recovery', 'removeJournalIds', 'removeOutboxIds']) if (batch?.[field] === null) delete batch[field];
  if (batch?.checkpoint) delete batch.checkpoint.journal;
  const validEntries = entries => Array.isArray(entries) && entries.every(entry => id(entry?.id) && entry.payload instanceof Uint8Array) &&
    new Set(entries.map(entry => entry.id)).size === entries.length;
  if (!batch || !id(batch.batchId) || !(batch.expectedRevision === null || id(batch.expectedRevision)) ||
      !id(batch.checkpoint?.revision) || !(batch.checkpoint.payload instanceof Uint8Array) || !validClock(batch.checkpoint.clock) ||
      batch.checkpoint.state !== undefined && !(batch.checkpoint.state instanceof Uint8Array) ||
      (batch.checkpoint.payload.length > 0 ? !(batch.checkpoint.snapshotAfterJournalId === null || id(batch.checkpoint.snapshotAfterJournalId))
        : batch.checkpoint.snapshotAfterJournalId !== undefined) ||
      !validEntries(batch.outbox) || batch.outbox.some(entry => !id(entry.revision) || reservedOrigin(entry.id)) ||
      batch.journal !== undefined && (!validEntries(batch.journal) || batch.journal.some(entry => reservedOrigin(entry.id) && !isOriginJournalId(entry.id))))
    throw storageError('InvalidCommitBatch', 'A complete checkpoint and distinct immutable records are required.');
  const retirement = batch.removeJournalIds !== undefined || batch.removeOutboxIds !== undefined;
  const recovery = batch.recovery;
  const validIds = values => Array.isArray(values) && values.every(id) && new Set(values).size === values.length;
  if (recovery !== undefined && (!id(recovery.generation) || !Number.isSafeInteger(recovery.revision) || recovery.revision < 0 ||
      !validClock(recovery.clock) || recovery.abandonedBranch !== undefined && typeof recovery.abandonedBranch !== 'boolean') ||
      (retirement || recovery !== undefined) && (!recovery || !batch.checkpoint.payload.length) ||
      batch.removeJournalIds !== undefined && !validIds(batch.removeJournalIds) ||
      batch.removeOutboxIds !== undefined && !validIds(batch.removeOutboxIds))
    throw storageError('InvalidCommitBatch', 'Recovery retirement requires a full native checkpoint and publication identity.');
  if (recovery) {
    if (Object.entries(recovery.clock).some(([author, sequence]) => sequence > clockAt(batch.checkpoint.clock, author)))
      throw storageError('InvalidCommitBatch', 'The publication cannot exceed the adopted native checkpoint.');
    for (const removed of batch.removeJournalIds ?? [])
      if ((!isOriginJournalId(removed) && !coveredByRecovery(removed, recovery) && !recovery.abandonedBranch) ||
          (batch.journal ?? []).some(entry => entry.id === removed))
        throw storageError('InvalidCommitBatch', 'Journal retirement exceeds the adopted publication.');
    for (const removed of batch.removeOutboxIds ?? [])
      if ((!coveredByRecovery(removed, recovery) && !recovery.abandonedBranch) || batch.outbox.some(entry => entry.id === removed))
        throw storageError('InvalidCommitBatch', 'Delivery retirement exceeds the adopted publication.');
  }
  // SharedArrayBuffer and oversized views must become compact ordinary buffers.
  batch.checkpoint.payload = new Uint8Array(batch.checkpoint.payload);
  if (batch.checkpoint.state !== undefined) batch.checkpoint.state = new Uint8Array(batch.checkpoint.state);
  for (const entry of [...batch.outbox, ...(batch.journal ?? [])]) entry.payload = new Uint8Array(entry.payload);
  if (batch.assets !== undefined) batch.assets = await prepareAssets(batch.assets);
  return { batch, digest: await batchDigest(batch) };
}
/** Hash the complete normalized request with explicit byte lengths and field presence.
 * Only the current opaque snapshot is retained; SHA-256 provides cryptographic
 * byte identity for retired batch receipts without retaining old scene payloads. */
async function batchDigest(batch) {
  const checkpoint = batch.checkpoint;
  const metadata = [1, batch.batchId, batch.expectedRevision, checkpoint.revision,
    Object.entries(checkpoint.clock).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    checkpoint.snapshotAfterJournalId === undefined ? [] : [checkpoint.snapshotAfterJournalId],
    checkpoint.payload.length, checkpoint.state?.length ?? null,
    batch.outbox.map(entry => [entry.id, entry.revision, entry.payload.length]),
    batch.journal === undefined ? null : batch.journal.map(entry => [entry.id, entry.payload.length])];
  // Additive resource support preserves receipt identities for pre-assets requests.
  if (batch.assets !== undefined) metadata.push(batch.assets.map(asset => [asset.hash, asset.data.length]));
  // Presence and every retirement ID are part of the same immutable commit receipt.
  if (batch.recovery !== undefined || batch.removeJournalIds !== undefined || batch.removeOutboxIds !== undefined)
    metadata.push(['recovery', batch.recovery ? [batch.recovery.generation, batch.recovery.revision,
      Object.entries(batch.recovery.clock).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), batch.recovery.abandonedBranch ?? false] : null,
      batch.removeJournalIds ?? null, batch.removeOutboxIds ?? null]);
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const parts = [checkpoint.payload, ...(checkpoint.state === undefined ? [] : [checkpoint.state]),
    ...batch.outbox.map(entry => entry.payload), ...(batch.journal ?? []).map(entry => entry.payload), ...(batch.assets ?? []).map(asset => asset.data)];
  const encoded = new Uint8Array(4 + header.length + parts.reduce((length, part) => length + part.length, 0));
  new DataView(encoded.buffer).setUint32(0, header.length);
  encoded.set(header, 4);
  let offset = 4 + header.length;
  for (const part of parts) { encoded.set(part, offset); offset += part.length; }
  if (!globalThis.crypto?.subtle) throw storageError('StorageUnavailable', 'SHA-256 is required for durable batch identity.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)), byte => byte.toString(16).padStart(2, '0')).join('');
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
export function checkReceipt(receipt, digest) {
  if (receipt.digest !== digest) throw storageError('BatchConflict', 'A batch ID cannot refer to different content.');
  return { batchId: receipt.batchId, revision: receipt.revision };
}
/** Receipts never recreate missing immutable evidence or ACKed pending membership. */
export function checkImmutableRecord(existing, entry, kind, receipt = false) {
  const equal = existing && (kind === 'outbox' ? equalOutbox(existing, entry) : equalBytes(existing.payload, entry.payload));
  if (receipt && !equal) throw storageError('StorageUnavailable', 'Immutable ' + kind + ' evidence is missing or changed.');
  if (existing && !equal) throw storageError('BatchConflict', kind + ' identities cannot change.');
}
/** Coverage authorizes retirement, never equality of arbitrary offered payloads. A matching
 * cryptographic batch receipt separately proves the original request's byte identity. */
export function coveredByRecovery(value, recovery) {
  const match = /^([A-Za-z0-9_-]{1,128}):([1-9][0-9]*)$/.exec(value);
  return !!match && Number.isSafeInteger(Number(match[2])) && Number(match[2]) <= clockAt(recovery?.clock, match[1]);
}
export function checkRetainedRecord(existing, entry, kind, recovery) {
  const retired = !existing && (coveredByRecovery(entry.id, recovery) ||
    kind === 'journal' && isOriginJournalId(entry.id) && recovery != null);
  checkImmutableRecord(existing, entry, kind, !retired);
}
/** Only a full native adoption can advance the retirement cut; logical lifecycle changes
 * require a new document namespace rather than relabeling persisted originals. */
export function checkRecovery(previous, batch) {
  const next = batch.recovery;
  if (!next) return previous;
  const sameClock = (left, right) => Object.entries(left).every(([author, seq]) => seq === clockAt(right, author)) &&
    Object.entries(right).every(([author, seq]) => seq === clockAt(left, author));
  if (previous && (previous.generation !== next.generation || previous.revision > next.revision ||
      Object.entries(previous.clock).some(([author, seq]) => seq > clockAt(next.clock, author)) ||
      previous.revision === next.revision && !sameClock(previous.clock, next.clock)))
    throw storageError('StorageConflict', 'The adopted publication cannot change lifecycle or rewind its covered cut.');
  return next;
}
export function checkRetiredInsertion(existing, entry, recovery) {
  if (!existing && coveredByRecovery(entry.id, recovery))
    throw storageError('StorageConflict', 'A new batch cannot restore a retired original identity.');
}
/** Native names the last included journal record; the batch tail is not a snapshot boundary. */
export function snapshotCut(previous, checkpoint, ordinal) {
  if (!checkpoint.payload.length) return previous ?? -1;
  const cut = checkpoint.snapshotAfterJournalId === null ? -1 : ordinal;
  if (cut === undefined || cut < (previous ?? -1)) throw storageError('StorageConflict', 'The snapshot journal boundary is missing or older than the current snapshot.');
  return cut;
}
/** Empty payloads append to the existing snapshot; only a replacing snapshot clears omitted state. */
export function checkpointMetadata(previous, checkpoint) {
  const { revision, clock } = checkpoint;
  const state = checkpoint.state ?? (checkpoint.payload.length === 0 ? previous?.state : undefined);
  const snapshotAfterJournalId = checkpoint.payload.length ? checkpoint.snapshotAfterJournalId : previous?.snapshotAfterJournalId;
  return { revision, clock, ...(state === undefined ? {} : { state }), ...(snapshotAfterJournalId === undefined ? {} : { snapshotAfterJournalId }) };
}
