import { test, expect } from '@playwright/test';

test('all IndexedDB operations run in the Worker; dispose/reopen preserves checkpoint and outbox', async ({ page }) => {
  await page.route('**/storage-worker-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto('/storage-worker-test');
  const result = await page.evaluate(async () => {
    indexedDB.open = () => { throw new Error('SDK attempted main-thread IndexedDB'); };
    indexedDB.deleteDatabase = () => { throw new Error('SDK attempted main-thread database deletion'); };
    const { createDocumentWorkerClient } = await import('/src/storage/worker-client.js');
    const databaseName = 'browser-' + crypto.randomUUID();
    const options = { namespace: 'account-a', documentId: 'diagram', persistence: 'persistent' };
    const open = async config => {
      const store = await createDocumentWorkerClient({ databaseName });
      return { store, session: await store.openSession(config) };
    };
    let { store, session } = await open(options);
    const batch = { batchId: 'batch-one', expectedRevision: null, checkpoint: { revision: 'r1', payload: new Uint8Array([10, 20, 30]), clock: { author: 1 } }, outbox: [{ id: 'txn-one', revision: 'r1', payload: new Uint8Array([40]) }] };
    await store.commitBatch(session, batch);
    await store.dispose(); // does not delete the document
    ({ store, session } = await open(options));
    const checkpoint = await store.readCheckpoint(session), delivery = await store.readReplicationState(session), outbox = delivery.outbox;
    const repeated = await store.commitBatch(session, batch);
    await store.acknowledgeOutbox(session, ['txn-one']);
    await store.commitBatch(session, batch); // lost ACK/commit response cannot reinsert an acknowledged entry
    const afterAck = await store.readOutbox(session);
    await store.deleteDocument(session);
    const deleted = await store.readCheckpoint(session);
    await store.dispose();
    return { checkpoint: { revision: checkpoint.revision, bytes: [...checkpoint.payload] }, clock: delivery.clock, outbox: outbox.map(entry => entry.id), repeated, afterAck, deleted };
  });
  expect(result).toEqual({ checkpoint: { revision: 'r1', bytes: [10, 20, 30] }, clock: { author: 1 }, outbox: ['txn-one'], repeated: { batchId: 'batch-one', revision: 'r1' }, afterAck: [], deleted: null });
});

test('origin-wide writer leases reject a second Worker and allow a new writer after close', async ({ page }) => {
  await page.route('**/storage-worker-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto('/storage-worker-test');
  const result = await page.evaluate(async () => {
    const { createDocumentWorkerClient } = await import('/src/storage/worker-client.js');
    const databaseName = 'browser-' + crypto.randomUUID();
    const options = { namespace: 'account-a', documentId: 'diagram', persistence: 'persistent' };
    const first = await createDocumentWorkerClient({ databaseName });
    const second = await createDocumentWorkerClient({ databaseName });
    const session = await first.openSession(options);
    let occupied;
    try { await second.openSession(options); } catch (error) { occupied = error.code; }
    await first.closeSession(session);
    const next = await second.openSession(options);
    let expired;
    try { await second.readCheckpoint(session); } catch (error) { expired = error.code; }
    await first.dispose(); await second.dispose();
    return { occupied, expired, differentLease: next.leaseId !== session.leaseId };
  });
  expect(result).toEqual({ occupied: 'StorageConflict', expired: 'StaleDocumentSession', differentLease: true });
});

test('independent document Workers restore an incremental suffix and retain ACK identity evidence', async ({ page }) => {
  await page.route('**/storage-worker-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto('/storage-worker-test');
  const result = await page.evaluate(async () => {
    indexedDB.open = () => { throw new Error('SDK attempted main-thread IndexedDB'); };
    const { createDocumentWorkerClient } = await import('/src/storage/worker-client.js');
    const databaseName = 'incremental-browser-' + crypto.randomUUID();
    const a = { namespace: 'account', documentId: 'a', persistence: 'persistent' };
    const b = { ...a, documentId: 'b' };
    let first = await createDocumentWorkerClient({ databaseName });
    const second = await createDocumentWorkerClient({ databaseName });
    let session = await first.openSession(a);
    const other = await second.openSession(b);
    const snapshot = { batchId: 'snapshot', expectedRevision: null,
      checkpoint: { revision: 'r1', payload: new Uint8Array([10]), state: new Uint8Array([1]), clock: { author: 1 } }, outbox: [] };
    await first.commitBatch(session, snapshot);
    await second.commitBatch(other, { ...snapshot, checkpoint: { ...snapshot.checkpoint, payload: new Uint8Array([99]) } });
    const append = { batchId: 'append', expectedRevision: 'r1',
      checkpoint: { revision: 'r2', payload: new Uint8Array(), state: new Uint8Array([2]), clock: { author: 2 } },
      journal: [{ id: 'tx', payload: new Uint8Array([20]) }], outbox: [{ id: 'tx', revision: 'r2', payload: new Uint8Array([20]) }] };
    await first.commitBatch(session, append);
    await first.dispose(); first = await createDocumentWorkerClient({ databaseName }); session = await first.openSession(a);
    const restored = await first.readCheckpoint(session);
    await first.acknowledgeOutbox(session, ['tx']);
    await first.commitBatch(session, { ...snapshot, batchId: 'new-snapshot', expectedRevision: 'r2', checkpoint: { ...snapshot.checkpoint, revision: 'r3' } });
    await first.commitBatch(session, append);
    let conflict;
    try { await first.commitBatch(session, { ...append, batchId: 'changed-id', expectedRevision: 'r3', journal: [{ id: 'tx', payload: new Uint8Array([21]) }] }); }
    catch (error) { conflict = error.code; }
    const final = await first.readCheckpoint(session);
    const pending = await first.readOutbox(session), independent = await second.readCheckpoint(other);
    await first.dispose(); await second.dispose();
    return { snapshot: [...restored.payload], state: [...restored.state], journal: restored.journal.map(row => ({ id: row.id, bytes: [...row.payload] })),
      revision: restored.revision, finalRevision: final.revision, finalJournal: final.journal ?? [], pending, independent: [...independent.payload], conflict };
  });
  expect(result).toEqual({ snapshot: [10], state: [2], journal: [{ id: 'tx', bytes: [20] }], revision: 'r2', finalRevision: 'r3', finalJournal: [], pending: [], independent: [99], conflict: 'BatchConflict' });
});

test('fresh Workers ignore retired databases and preserve only current-generation data', async ({ page }) => {
  await page.route('**/storage-worker-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto('/storage-worker-test');
  const result = await page.evaluate(async () => {
    const { seedRetiredDocumentStores } = await import('/test/fixtures/retired-document-stores.mjs');
    const { createDocumentWorkerClient } = await import('/src/storage/worker-client.js');
    const databaseName = 'fresh-browser-' + crypto.randomUUID();
    const configuration = { namespace: 'account', documentId: 'opaque:document', persistence: 'persistent' };
    await seedRetiredDocumentStores(databaseName, configuration);
    indexedDB.open = () => { throw new Error('SDK attempted main-thread IndexedDB'); };
    indexedDB.deleteDatabase = () => { throw new Error('SDK attempted main-thread database deletion'); };
    let store = await createDocumentWorkerClient({ databaseName }), session = await store.openSession(configuration);
    const initial = await store.readCheckpoint(session), initialOutbox = await store.readOutbox(session);
    const batch = { batchId: 'current', expectedRevision: null, checkpoint: { revision: 'r1', payload: new Uint8Array([10]), clock: { author: 1 } },
      outbox: [{ id: 'current', revision: 'r1', payload: new Uint8Array([20]) }] };
    await store.commitBatch(session, batch); await store.dispose();
    store = await createDocumentWorkerClient({ databaseName }); session = await store.openSession(configuration);
    const restored = await store.readCheckpoint(session);
    await store.acknowledgeOutbox(session, ['current']);
    const receipt = await store.commitBatch(session, batch), pending = await store.readOutbox(session);
    await store.deleteDocument(session); await store.dispose();
    store = await createDocumentWorkerClient({ databaseName }); session = await store.openSession(configuration);
    const deleted = await store.readCheckpoint(session), deletedOutbox = await store.readOutbox(session);
    await store.dispose();
    return { initial, initialOutbox, restored: [...restored.payload], receipt, pending, deleted, deletedOutbox };
  });
  expect(result).toEqual({ initial: null, initialOutbox: [], restored: [10], receipt: { batchId: 'current', revision: 'r1' }, pending: [], deleted: null, deletedOutbox: [] });
});
