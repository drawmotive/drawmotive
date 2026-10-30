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
