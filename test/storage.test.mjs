import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { IDBObjectStore } from 'fake-indexeddb';
import { seedRetiredDocumentStores } from './fixtures/retired-document-stores.mjs';

const database = await import('../src/storage/worker/database.ts').catch(() => ({}));
const memory = await import('../src/storage/memory-store.js').catch(() => ({}));
const bytes = text => new TextEncoder().encode(text);
const options = (namespace = 'account-a', documentId = 'drawing') => ({ namespace, documentId, persistence: 'persistent' });
const batch = (id, previous, revision, text = revision) => ({ batchId: id, expectedRevision: previous, checkpoint: { revision, payload: bytes(text), clock: { author: 1 }, ...(text ? { snapshotAfterJournalId: null } : {}) }, outbox: [{ id, revision, payload: bytes(text) }] });

for (const kind of ['dexie', 'memory']) {
  test(kind + ': delivery reads one atomic checkpoint clock and outbox, including rollback and exact retries', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    const store = create({ databaseName: 'test-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    assert.deepEqual(await store.readReplicationState(session), { clock: {}, outbox: [], snapshotKey: 'origin' });
    const first = batch('one', null, 'r1');
    await store.commitBatch(session, first);
    const invalid = batch('two', 'r1', 'r2'); invalid.checkpoint.clock.author = 2;
    invalid.outbox = [{ ...invalid.outbox[0], id: 'one' }];
    await assert.rejects(store.commitBatch(session, invalid), { code: 'BatchConflict' });
    assert.deepEqual(await store.readReplicationState(session), { clock: { author: 1 }, outbox: first.outbox.map(({ id, payload }) => ({ id, payload })), snapshotKey: 'origin' });
    const changedClock = structuredClone(first); changedClock.checkpoint.clock.author = 2;
    await assert.rejects(store.commitBatch(session, changedClock), { code: 'BatchConflict' });
    const next = batch('two', 'r1', 'r2'); next.checkpoint.clock.author = 2;
    await store.commitBatch(session, next);
    const state = await store.readReplicationState(session); state.clock.author = 99; state.outbox[0].payload[0] = 0;
    await store.acknowledgeOutbox(session, ['one']);
    await store.commitBatch(session, first);
    assert.deepEqual(await store.readReplicationState(session), { clock: { author: 2 }, outbox: next.outbox.map(({ id, payload }) => ({ id, payload })), snapshotKey: 'origin' });
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
    commit.checkpoint.state = payload; commit.journal = [{ id: 'transaction', payload }];
    const pending = store.commitBatch(session, commit);
    payload[0] = 9;
    await pending;
    payload[0] = 6;
    const first = await store.readCheckpoint(session);
    assert.deepEqual([...first.payload], [1]);
    first.payload[0] = 8;
    const outbox = await store.readOutbox(session); outbox[0].payload[0] = 7;
    assert.deepEqual([...(await store.readCheckpoint(session)).payload], [1]);
    assert.deepEqual([...(await store.readCheckpoint(session)).state], [1]);
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
    assert.deepEqual(await store.readCheckpoint(session), { revision: 'r1', payload: bytes('r1'), clock: { author: 1 }, snapshotAfterJournalId: null });
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

for (const kind of ['dexie', 'memory']) {
  const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
  test(kind + ': incremental commits retain a snapshot and restore only its ordered journal suffix', async () => {
    const store = create({ databaseName: 'incremental-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    const first = batch('initial', null, 'r1', 'scene');
    first.checkpoint.state = bytes('state-1'); first.journal = [{ id: 'tx-1', payload: bytes('first') }];
    first.checkpoint.snapshotAfterJournalId = 'tx-1';
    await store.commitBatch(session, first);
    const next = batch('append', 'r1', 'r2', '');
    next.checkpoint.state = bytes('state-2'); next.checkpoint.clock.author = 2;
    next.journal = [{ id: 'tx-2', payload: bytes('second') }];
    await store.commitBatch(session, next);
    next.journal[0].payload[0] = 0; next.checkpoint.state[0] = 0;
    assert.deepEqual(await store.readCheckpoint(session), {
      revision: 'r2', payload: bytes('scene'), clock: { author: 2 }, state: bytes('state-2'), snapshotAfterJournalId: 'tx-1',
      journal: [{ id: 'tx-2', payload: bytes('second') }],
    });
    const metadata = batch('metadata', 'r2', 'r3', ''); metadata.outbox = [];
    await store.commitBatch(session, metadata);
    assert.deepEqual((await store.readCheckpoint(session)).state, bytes('state-2'));
    const snapshot = batch('snapshot', 'r3', 'r4', 'new-scene'); snapshot.outbox = []; snapshot.checkpoint.snapshotAfterJournalId = 'tx-2';
    await store.commitBatch(session, snapshot);
    assert.deepEqual(await store.readCheckpoint(session), { revision: 'r4', payload: bytes('new-scene'), clock: { author: 1 }, snapshotAfterJournalId: 'tx-2' });
    await assert.rejects(store.commitBatch(session, { ...batch('changed-transaction', 'r4', 'r5', ''),
      journal: [{ id: 'tx-2', payload: bytes('different') }] }), { code: 'BatchConflict' });
    assert.equal((await store.readCheckpoint(session)).revision, 'r4');
    await store.dispose();
  });

  test(kind + ': exact receipts retain every request field after ACK and snapshot replacement', async () => {
    const store = create({ databaseName: 'receipts-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    const original = batch('original', null, 'r1'); original.checkpoint.state = bytes('state');
    original.journal = [{ id: 'tx', payload: bytes('transaction') }];
    await store.commitBatch(session, original);
    await store.acknowledgeOutbox(session, ['original']);
    const snapshot = batch('replacement', 'r1', 'r2'); snapshot.outbox = [];
    await store.commitBatch(session, snapshot);
    assert.deepEqual(await store.commitBatch(session, original), { batchId: 'original', revision: 'r1' });
    for (const change of [
      value => { value.expectedRevision = 'wrong'; },
      value => { value.checkpoint.state[0]++; },
      value => { value.checkpoint.clock.author++; },
      value => { value.journal[0].payload[0]++; },
      value => { value.outbox[0].payload[0]++; },
      value => { value.checkpoint.payload[0]++; },
      value => { value.checkpoint.snapshotAfterJournalId = 'tx'; },
      value => { value.checkpoint.payload = bytes(''); },
      value => { value.outbox[0].revision = 'different'; },
      value => { value.journal = []; },
    ]) {
      const changed = structuredClone(original); change(changed);
      await assert.rejects(store.commitBatch(session, changed), { code: 'BatchConflict' });
    }
    const later = batch('later', 'r2', 'r3'); later.outbox = structuredClone(original.outbox);
    await store.commitBatch(session, later);
    assert.deepEqual(await store.readOutbox(session), []);
    const conflict = batch('conflict', 'r3', 'r4'); conflict.outbox = [{ ...original.outbox[0], payload: bytes('changed') }];
    await assert.rejects(store.commitBatch(session, conflict), { code: 'BatchConflict' });
    await store.dispose();
  });
}

const openRaw = async name => {
  const db = new Dexie(name); await db.open(); return db;
};
test('persistent identities get separate collision-free databases without account keys on document rows', async () => {
  const prefix = 'identity-' + crypto.randomUUID(), before = new Set((await indexedDB.databases()).map(row => row.name));
  for (const [namespace, documentId] of [['a:b', 'c'], ['a', 'b:c'], ['a', 'b/c'], ['a', 'b%2Fc']]) {
    const store = database.createDocumentDatabase({ databaseName: prefix, acquireWriter: async () => () => {} });
    const session = await store.openSession(options(namespace, documentId));
    await store.commitBatch(session, batch('first', null, 'r1', namespace + documentId));
    await store.dispose();
  }
  const names = (await indexedDB.databases()).map(row => row.name).filter(name => !before.has(name));
  assert.equal(names.length, 4);
  assert.equal(new Set(names).size, 4);
  for (const name of names) {
    const db = await openRaw(name);
    for (const table of db.tables) for (const row of await table.toArray()) {
      assert.equal(Object.hasOwn(row, 'documentKey'), false);
      assert.equal(Object.hasOwn(row, 'fingerprint'), false);
    }
    db.close();
  }
});

test('normal incremental appends never rewrite an earlier snapshot or journal record', async () => {
  const store = database.createDocumentDatabase({ databaseName: 'writes-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
  const session = await store.openSession(options());
  const initial = batch('initial', null, 'r1'); initial.checkpoint.payload = new Uint8Array(100000);
  initial.outbox = []; initial.journal = [{ id: 'old', payload: bytes('old') }];
  await store.commitBatch(session, initial);
  const writes = [], original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...args) { writes.push({ table: this.name, value: structuredClone(value) }); return original.call(this, value, ...args); };
  try {
    const append = batch('append', 'r1', 'r2', ''); append.outbox = []; append.journal = [{ id: 'new', payload: bytes('new') }];
    await store.commitBatch(session, append);
  } finally { IDBObjectStore.prototype.put = original; }
  assert.ok(writes.length > 0);
  assert.equal(writes.some(write => write.value.payload?.byteLength === 100000 || write.value.checkpoint?.payload?.byteLength === 100000), false);
  assert.equal(writes.some(write => write.value.id === 'old'), false);
  assert.equal(writes.filter(write => write.value.id === 'new' && write.value.payload).length, 1);
  await store.dispose();
});

test('snapshot replacement bounds payload storage while digest receipts still reject changed retries', async t => {
  const prefix = 'bounded-snapshot-' + crypto.randomUUID();
  const store = database.createDocumentDatabase({ databaseName: prefix, acquireWriter: async () => () => {} });
  t.after(() => store.dispose());
  const session = await store.openSession(options());
  const original = batch('initial', null, 'r1', 'retired-payload'); original.journal = [{ id: 'tx1', payload: bytes('one') }];
  original.checkpoint.state = bytes('retired-state'); original.checkpoint.snapshotAfterJournalId = 'tx1';
  await store.commitBatch(session, original);
  await store.acknowledgeOutbox(session, ['initial']);
  for (const [id, previous, revision, text] of [['second', 'r1', 'r2', 'second-payload'], ['third', 'r2', 'r3', 'current-payload']]) {
    const replacement = batch(id, previous, revision, text); replacement.checkpoint.snapshotAfterJournalId = 'tx1';
    await store.commitBatch(session, replacement);
  }
  const raw = await openRaw(prefix + ':document-v4:' + encodeURIComponent(JSON.stringify(['account-a', 'drawing'])));
  t.after(() => raw.close());
  assert.deepEqual((await raw.table('snapshots').toArray()).map(row => [...row.payload]), [[...bytes('current-payload')]]);
  const receipts = await raw.table('receipts').toArray();
  assert.equal(receipts.length, 3);
  const hasBytes = value => value instanceof Uint8Array || value !== null && typeof value === 'object' && Object.values(value).some(hasBytes);
  assert.equal(receipts.some(hasBytes), false, 'Receipts must not retain historical snapshot or state bytes.');
  assert.deepEqual(await store.commitBatch(session, original), { batchId: 'initial', revision: 'r1' });
  const changed = structuredClone(original); changed.checkpoint.payload[0]++;
  await assert.rejects(store.commitBatch(session, changed), { code: 'BatchConflict' });
  const reframed = structuredClone(original);
  reframed.checkpoint.payload = original.checkpoint.payload.slice(0, -1);
  reframed.checkpoint.state = new Uint8Array([original.checkpoint.payload.at(-1), ...original.checkpoint.state]);
  await assert.rejects(store.commitBatch(session, reframed), { code: 'BatchConflict' });
  await raw.table('journal').update('tx1', { payload: bytes('corrupt') });
  await assert.rejects(store.commitBatch(session, original), { code: 'StorageUnavailable' });
  await raw.table('journal').update('tx1', { payload: bytes('one') });
  await raw.table('outbox').delete('initial');
  await assert.rejects(store.commitBatch(session, original), { code: 'StorageUnavailable' });
});

test('v4 ignores every retired format while current commits survive reopening and ACK retries', async t => {
  const prefix = 'fresh-' + crypto.randomUUID(), configuration = options('account/a', 'opaque:document');
  const retired = await seedRetiredDocumentStores(prefix, configuration);
  const opened = [], deleted = [], originalOpen = indexedDB.open, originalDelete = indexedDB.deleteDatabase;
  indexedDB.open = function (name, ...args) {
    opened.push(name);
    assert.ok(!retired.names.includes(name), 'The SDK must not open a retired database.');
    return originalOpen.call(this, name, ...args);
  };
  indexedDB.deleteDatabase = function (name, ...args) { deleted.push(name); return originalDelete.call(this, name, ...args); };
  t.after(() => { indexedDB.open = originalOpen; indexedDB.deleteDatabase = originalDelete; });
  const create = () => database.createDocumentDatabase({ databaseName: prefix, acquireWriter: async () => () => {} });
  let store = create();
  t.after(() => store.dispose());
  let session = await store.openSession(configuration);
  assert.equal(await store.readCheckpoint(session), null);
  assert.deepEqual(await store.readReplicationState(session), { clock: {}, outbox: [], snapshotKey: 'origin' });
  const first = batch('first', null, 'r1', 'current-scene'); first.checkpoint.state = bytes('state-1');
  await store.commitBatch(session, first);
  const append = batch('append', 'r1', 'r2', '');
  append.checkpoint.state = bytes('state-2'); append.checkpoint.clock.author = 2;
  append.journal = [{ id: 'tx-2', payload: bytes('current-transaction') }];
  await store.commitBatch(session, append);
  await store.dispose(); store = create(); session = await store.openSession(configuration);
  assert.deepEqual(await store.readCheckpoint(session), {
    revision: 'r2', payload: bytes('current-scene'), state: bytes('state-2'), clock: { author: 2 }, snapshotAfterJournalId: null, journal: append.journal,
  });
  assert.deepEqual((await store.readOutbox(session)).map(row => row.id), ['first', 'append']);
  assert.deepEqual(await store.readRetainedJournal(session), { revision: 'r2', clock: { author: 2 }, journal: append.journal });
  await store.acknowledgeOutbox(session, ['first', 'append']);
  const snapshot = batch('snapshot', 'r2', 'r3', 'replacement'); snapshot.outbox = []; snapshot.checkpoint.snapshotAfterJournalId = 'tx-2';
  await store.commitBatch(session, snapshot);
  assert.deepEqual(await store.commitBatch(session, first), { batchId: 'first', revision: 'r1' });
  assert.deepEqual(await store.commitBatch(session, append), { batchId: 'append', revision: 'r2' });
  assert.deepEqual(await store.readOutbox(session), []);
  await store.deleteDocument(session); await store.closeSession(session);
  session = await store.openSession(configuration);
  assert.equal(await store.readCheckpoint(session), null);
  assert.deepEqual(await store.readReplicationState(session), { clock: {}, outbox: [], snapshotKey: 'origin' });
  await store.commitBatch(session, first);
  await store.closeSession(session); session = await store.openSession(configuration);
  assert.deepEqual(await store.readCheckpoint(session), first.checkpoint);
  assert.ok(opened.length > 1);
  assert.deepEqual([...new Set(opened)], [prefix + ':document-v4:' + encodeURIComponent(JSON.stringify(['account/a', 'opaque:document']))]);
  assert.deepEqual(deleted, [], 'Opening, closing and explicit document deletion must never delete database files.');
});

for (const kind of ['dexie', 'memory']) {
  test(kind + ': obsolete alias options reject before acquiring document ownership', async t => {
    let locks = 0;
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    const store = create({ databaseName: 'rejected-option-' + crypto.randomUUID(), acquireWriter: async () => { locks++; return () => {}; } });
    t.after(() => store.dispose());
    await assert.rejects(store.openSession({ ...options(), legacyDocumentId: 'previous' }), { code: 'InvalidDocumentSession' });
    assert.equal(locks, 0);
    const session = await store.openSession(options('opaque/account', '5b3e9766-3703-49af-957d-770526da2748'));
    assert.equal(await store.readCheckpoint(session), null, 'SDK document identities remain opaque.');
  });
}

for (const kind of ['dexie', 'memory']) {
  const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
  test(kind + ': explicit snapshot cuts replay later records from the same atomic batch', async t => {
    const store = create({ databaseName: 'snapshot-cut-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    t.after(() => store.dispose());
    const session = await store.openSession(options());
    assert.deepEqual(await store.readRetainedJournal(session), { revision: null, clock: {}, journal: [] });
    const first = batch('initial', null, 'r100', 'scene-100'); first.outbox = [];
    first.journal = [{ id: 'tx100', payload: bytes('transaction-100') }]; first.checkpoint.snapshotAfterJournalId = 'tx100';
    await store.commitBatch(session, first);
    const next = batch('next', 'r100', 'r101', 'scene-100');
    next.checkpoint.snapshotAfterJournalId = 'tx100'; next.checkpoint.clock.author = 101;
    next.journal = [{ id: 'tx101', payload: bytes('transaction-101') }];
    await store.commitBatch(session, next);
    assert.equal((await store.readReplicationState(session)).snapshotKey, 'tx100');
    assert.deepEqual(await store.readCheckpoint(session), { revision: 'r101', payload: bytes('scene-100'),
      clock: { author: 101 }, snapshotAfterJournalId: 'tx100', journal: [{ id: 'tx101', payload: bytes('transaction-101') }] });
    const retained = await store.readRetainedJournal(session);
    assert.deepEqual(retained, { revision: 'r101', clock: { author: 101 }, journal: [
      { id: 'tx100', payload: bytes('transaction-100') }, { id: 'tx101', payload: bytes('transaction-101') },
    ] });
    retained.journal[0].payload[0] = 0; retained.clock.author = 999;
    await store.acknowledgeOutbox(session, ['next']);
    assert.deepEqual(await store.readOutbox(session), []);
    assert.equal((await store.readRetainedJournal(session)).journal[0].payload[0], 't'.charCodeAt(0));
    const final = batch('final', 'r101', 'r102', 'scene-102'); final.outbox = []; final.checkpoint.snapshotAfterJournalId = 'tx101';
    await store.commitBatch(session, final);
    assert.equal((await store.readReplicationState(session)).snapshotKey, 'tx101');
    assert.equal((await store.readCheckpoint(session)).journal, undefined);
    assert.deepEqual(await store.commitBatch(session, next), { batchId: 'next', revision: 'r101' });
    assert.equal((await store.readCheckpoint(session)).revision, 'r102');
    assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['tx100', 'tx101']);
    await assert.rejects(store.readRetainedJournal({ ...session, leaseId: 'expired' }), { code: 'StaleDocumentSession' });
    await store.deleteDocument(session);
    assert.deepEqual(await store.readRetainedJournal(session), { revision: null, clock: {}, journal: [] });
  });

  test(kind + ': invalid snapshot cuts reject the entire batch before changing history or delivery', async t => {
    const store = create({ databaseName: 'invalid-cut-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    t.after(() => store.dispose());
    const session = await store.openSession(options());
    const first = batch('initial', null, 'r1'); first.outbox = [];
    first.journal = [{ id: 'tx1', payload: bytes('one') }]; first.checkpoint.snapshotAfterJournalId = 'tx1';
    await store.commitBatch(session, first);
    for (const change of [
      value => { delete value.checkpoint.snapshotAfterJournalId; },
      value => { value.checkpoint.snapshotAfterJournalId = 'missing'; },
      value => { value.checkpoint.snapshotAfterJournalId = null; },
      value => { value.checkpoint.snapshotAfterJournalId = 42; },
      value => { value.checkpoint.payload = new Uint8Array(); value.checkpoint.snapshotAfterJournalId = 'tx1'; },
    ]) {
      const invalid = batch('invalid-' + crypto.randomUUID(), 'r1', 'r2');
      invalid.journal = [{ id: 'tx2', payload: bytes('two') }]; change(invalid);
      await assert.rejects(store.commitBatch(session, invalid), error => ['InvalidCommitBatch', 'StorageConflict'].includes(error.code));
      assert.equal((await store.readCheckpoint(session)).revision, 'r1');
      assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['tx1']);
      assert.deepEqual(await store.readOutbox(session), []);
    }
  });

  test(kind + ': archival origins remain ordered for cold recovery and never enter replay or delivery', async t => {
    const store = create({ databaseName: 'origins-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    t.after(() => store.dispose());
    const session = await store.openSession(options());
    const origin1 = '$origin:0123456789abcdef0123456789abcdef', origin2 = '$origin:abcdef0123456789abcdef0123456789';
    const initial = batch('initial', null, 'r1', 'scene'); initial.outbox = [];
    initial.journal = [{ id: origin1, payload: bytes('original-scene') }, { id: 'tx1', payload: bytes('one') }];
    initial.checkpoint.snapshotAfterJournalId = origin1;
    await store.commitBatch(session, initial);
    const append = batch('append', 'r1', 'r2', ''); append.outbox = [];
    append.journal = [{ id: origin2, payload: bytes('replacement-origin') }, { id: 'tx2', payload: bytes('two') }];
    await store.commitBatch(session, append);
    assert.deepEqual((await store.readCheckpoint(session)).journal.map(row => row.id), ['tx1', 'tx2']);
    assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), [origin1, 'tx1', origin2, 'tx2']);
    const badDelivery = batch('bad-delivery', 'r2', 'r3', '');
    badDelivery.outbox = [{ id: origin2, revision: 'r3', payload: bytes('replacement-origin') }];
    await assert.rejects(store.commitBatch(session, badDelivery), { code: 'InvalidCommitBatch' });
    const malformed = batch('bad-origin', 'r2', 'r3', ''); malformed.outbox = [];
    malformed.journal = [{ id: '$origin:UPPERCASE', payload: bytes('bad') }];
    await assert.rejects(store.commitBatch(session, malformed), { code: 'InvalidCommitBatch' });
    assert.equal((await store.readCheckpoint(session)).revision, 'r2');
    assert.deepEqual(await store.readOutbox(session), []);
  });
}

for (const kind of ['dexie', 'memory']) {
  test(kind + ': nullable interop fields normalize to absent metadata and read-only journal fields are ignored', async () => {
    const create = kind === 'dexie' ? database.createDocumentDatabase : memory.createMemoryDocumentStore;
    const store = create({ databaseName: 'interop-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    const session = await store.openSession(options());
    const request = batch('interop', null, 'r1');
    request.checkpoint.state = null; request.checkpoint.journal = null; request.journal = null;
    await store.commitBatch(session, request);
    assert.deepEqual(await store.readCheckpoint(session), batch('interop', null, 'r1').checkpoint);
    assert.deepEqual(await store.commitBatch(session, batch('interop', null, 'r1')), { batchId: 'interop', revision: 'r1' });
    await store.dispose();
  });
}
