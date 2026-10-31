import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const database = await import('../src/storage/worker/database.ts').catch(() => ({}));
const memory = await import('../src/storage/memory-store.js').catch(() => ({}));
const bytes = text => new TextEncoder().encode(text);
const options = (namespace = 'account-a', documentId = 'drawing') => ({ namespace, documentId, persistence: 'persistent' });
const batch = (id, previous, revision, text = revision) => ({ batchId: id, expectedRevision: previous, checkpoint: { revision, payload: bytes(text), clock: { author: 1 } }, outbox: [{ id, revision, payload: bytes(text) }] });

for (const kind of ['dexie', 'memory']) {
  test(kind + ': delivery reads one atomic checkpoint clock and outbox, including rollback and exact retries', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    const store = create({ databaseName: 'test-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    assert.deepEqual(await store.readReplicationState(session), { clock: {}, outbox: [] });
    const first = batch('one', null, 'r1');
    await store.commitBatch(session, first);
    const invalid = batch('two', 'r1', 'r2'); invalid.checkpoint.clock.author = 2;
    invalid.outbox = [{ ...invalid.outbox[0], id: 'one' }];
    await assert.rejects(store.commitBatch(session, invalid), { code: 'BatchConflict' });
    assert.deepEqual(await store.readReplicationState(session), { clock: { author: 1 }, outbox: first.outbox.map(({ id, payload }) => ({ id, payload })) });
    const changedClock = structuredClone(first); changedClock.checkpoint.clock.author = 2;
    await assert.rejects(store.commitBatch(session, changedClock), { code: 'BatchConflict' });
    const next = batch('two', 'r1', 'r2'); next.checkpoint.clock.author = 2;
    await store.commitBatch(session, next);
    const state = await store.readReplicationState(session); state.clock.author = 99; state.outbox[0].payload[0] = 0;
    await store.acknowledgeOutbox(session, ['one']);
    await store.commitBatch(session, first);
    assert.deepEqual(await store.readReplicationState(session), { clock: { author: 2 }, outbox: next.outbox.map(({ id, payload }) => ({ id, payload })) });
    await store.dispose();
  });

  test(kind + ': ACK owns an immutable copy of the confirmed IDs before entering the queue', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    const store = create({ databaseName: 'test-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    const commit = batch('one', null, 'r1');
    commit.outbox = ['confirmed', 'unsent'].map(id => ({ id, revision: 'r1', payload: bytes(id) }));
    await store.commitBatch(session, commit);
    const ids = ['confirmed'];
    const acknowledgement = store.acknowledgeOutbox(session, ids);
    ids[0] = 'unsent';
    await acknowledgement;
    assert.deepEqual((await store.readOutbox(session)).map(entry => entry.id), ['unsent']);
    await store.dispose();
  });

  test(kind + ': shared buffers and returned snapshots cannot mutate a committed checkpoint or outbox', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    const store = create({ databaseName: 'test-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    const payload = new Uint8Array(new SharedArrayBuffer(1)); payload[0] = 1;
    const commit = batch('one', null, 'r1');
    commit.checkpoint.payload = payload; commit.outbox[0].payload = payload;
    const pending = store.commitBatch(session, commit);
    payload[0] = 9;
    await pending;
    payload[0] = 6;
    const first = await store.readCheckpoint(session);
    assert.deepEqual([...first.payload], [1]);
    first.payload[0] = 8;
    const outbox = await store.readOutbox(session); outbox[0].payload[0] = 7;
    assert.deepEqual([...(await store.readCheckpoint(session)).payload], [1]);
    assert.deepEqual([...(await store.readOutbox(session))[0].payload], [1]);
    await store.dispose();
  });

  test(kind + ': commits restore the entire checkpoint and reject stale/changed duplicate batches', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    assert.equal(typeof create, 'function', kind + ' store exists');
    const store = create({ databaseName: 'test-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    const original = batch('one', null, 'r1');
    assert.deepEqual(await store.commitBatch(session, original), { batchId: 'one', revision: 'r1' });
    original.checkpoint.payload[0] = 0;
    assert.deepEqual(await store.readCheckpoint(session), { revision: 'r1', payload: bytes('r1'), clock: { author: 1 } });
    assert.deepEqual(await store.commitBatch(session, batch('one', null, 'r1')), { batchId: 'one', revision: 'r1' });
    await assert.rejects(store.commitBatch(session, batch('one', null, 'r1', 'changed')), { code: 'BatchConflict' });
    await assert.rejects(store.commitBatch(session, batch('two', null, 'r2')), { code: 'StorageConflict' });
    assert.equal((await store.readCheckpoint(session)).revision, 'r1');
    await store.closeSession(session);
    await store.dispose();
  });

  test(kind + ': failed commits leave checkpoint/outbox unchanged and ACKs cannot be reinserted by a later edit', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    assert.equal(typeof create, 'function');
    const store = create({ databaseName: 'test-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    await store.commitBatch(session, batch('one', null, 'r1'));
    const conflicting = batch('two', 'r1', 'r2');
    conflicting.outbox = [{ id: 'one', revision: 'r2', payload: bytes('bad') }];
    await assert.rejects(store.commitBatch(session, conflicting), { code: 'BatchConflict' });
    assert.equal((await store.readCheckpoint(session)).revision, 'r1');
    assert.deepEqual((await store.readOutbox(session)).map(entry => entry.id), ['one']);
    await store.acknowledgeOutbox(session, ['one']);
    await store.acknowledgeOutbox(session, ['one']);
    await store.commitBatch(session, batch('two', 'r1', 'r2'));
    assert.deepEqual((await store.readOutbox(session)).map(entry => entry.id), ['two']);
    await store.closeSession(session);
    await store.dispose();
  });

  test(kind + ': account namespaces, single-writer ownership and expired sessions are isolated', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    assert.equal(typeof create, 'function');
    const store = create({ databaseName: 'test-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    await assert.rejects(store.openSession(options()), { code: 'StorageConflict' });
    await assert.rejects(store.openSession(options('account-b')), { code: 'StorageConflict' });
    await store.commitBatch(session, batch('one', null, 'r1'));
    await assert.rejects(store.readCheckpoint({ ...session, namespace: 'wrong' }), { code: 'StaleDocumentSession' });
    await assert.rejects(store.readCheckpoint({ ...session, leaseId: 'expired' }), { code: 'StaleDocumentSession' });
    await store.closeSession(session);
    await assert.rejects(store.readCheckpoint(session), { code: 'StaleDocumentSession' });
    const other = await store.openSession(options('account-b'));
    assert.equal(await store.readCheckpoint(other), null);
    await store.closeSession(other);
    const reopened = await store.openSession(options());
    await assert.rejects(store.readCheckpoint(session), { code: 'StaleDocumentSession' });
    if (kind === 'dexie') assert.equal((await store.readCheckpoint(reopened)).revision, 'r1');
    await store.deleteDocument(reopened);
    assert.equal(await store.readCheckpoint(reopened), null);
    await store.closeSession(reopened);
    await store.dispose();
  });
}


test('disposing during database startup releases the pending writer lease', async () => {
  let acquire, released = 0;
  const store = database.createDocumentDatabase({ databaseName: 'test-' + crypto.randomUUID(),
    acquireWriter: () => new Promise(resolve => { acquire = resolve; }) });
  const opening = store.openSession(options());
  await store.dispose();
  acquire(() => { released++; });
  await assert.rejects(opening, { code: 'EditorDisposed' });
  assert.equal(released, 1);
});
