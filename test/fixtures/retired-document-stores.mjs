/** Frozen pre-v3 schemas seed disposable test databases; the SDK must never open them. */
export async function seedRetiredDocumentStores(prefix, configuration) {
  const key = JSON.stringify([configuration.namespace, configuration.documentId]);
  const checkpoint = { revision: 'retired', payload: new Uint8Array([42]), clock: { retired: 1 } };
  const pending = { id: 'retired-pending', revision: 'retired', payload: new Uint8Array([43]) };
  const sharedName = prefix, previousName = prefix + ':document-v2:' + encodeURIComponent(key);
  const schemas = [
    [sharedName, {
      documents: { keyPath: 'key', rows: [{ key, checkpoint, nextOrdinal: 1 }] },
      outbox: { keyPath: ['documentKey', 'id'], indexes: { documentKey: 'documentKey', '[documentKey+ordinal]': ['documentKey', 'ordinal'] }, rows: [{ ...pending, documentKey: key, ordinal: 0 }] },
      receipts: { keyPath: ['documentKey', 'batchId'], indexes: { documentKey: 'documentKey' }, rows: [] },
    }],
    [previousName, {
      meta: { keyPath: 'key', rows: [{ key: 'head', checkpoint: { revision: 'retired', clock: { retired: 1 } }, snapshotId: 'retired', snapshotOrdinal: 0, nextJournalOrdinal: 1, nextOutboxOrdinal: 1 }, { key: 'migration', complete: true }] },
      snapshots: { keyPath: 'id', rows: [{ id: 'retired', payload: checkpoint.payload }] },
      journal: { keyPath: 'id', indexes: { ordinal: 'ordinal' }, rows: [{ id: 'retired', ordinal: 0, payload: new Uint8Array([44]) }] },
      outbox: { keyPath: 'id', rows: [pending] },
      pending: { keyPath: 'id', indexes: { ordinal: 'ordinal' }, rows: [{ id: pending.id, ordinal: 0 }] },
      receipts: { keyPath: 'batchId', rows: [] },
    }],
  ];
  for (const [name, tables] of schemas) await new Promise((resolve, reject) => {
    // Dexie schema version 1 uses native IndexedDB version 10.
    const request = indexedDB.open(name, 10);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      for (const [table, definition] of Object.entries(tables)) {
        const store = request.result.createObjectStore(table, { keyPath: definition.keyPath });
        for (const [index, keyPath] of Object.entries(definition.indexes ?? {})) store.createIndex(index, keyPath, { unique: index === 'ordinal' });
      }
    };
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(Object.keys(tables), 'readwrite');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
      for (const [table, definition] of Object.entries(tables))
        for (const row of definition.rows) transaction.objectStore(table).put(row);
    };
  });
  return { sharedName, previousName };
}
