import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBObjectStore } from 'fake-indexeddb';
import { createDocumentDatabase } from '../src/storage/worker/database.ts';
import { createMemoryDocumentStore } from '../src/storage/memory-store.js';

const bytes = value => new TextEncoder().encode(value);
const generation = '55eb148e-9fd0-43f3-908e-6634cdb13daa';
const options = { namespace: 'account', documentId: 'diagram', persistence: 'persistent' };
const initial = () => ({ batchId: 'original', expectedRevision: null,
  checkpoint: { revision: 'r1', payload: bytes('scene'), clock: { A: 2 }, snapshotAfterJournalId: 'A:2' },
  journal: [1, 2].map(n => ({ id: 'A:' + n, payload: bytes('edit' + n) })),
  outbox: [1, 2].map(n => ({ id: 'A:' + n, revision: 'r1', payload: bytes('edit' + n) })) });
const adoption = () => ({ batchId: 'adoption', expectedRevision: 'r1',
  checkpoint: { revision: 'r2', payload: bytes('adopted'), clock: { A: 2 }, snapshotAfterJournalId: 'A:2' },
  recovery: { generation, revision: 1, clock: { A: 1 } },
  removeJournalIds: ['A:1'], removeOutboxIds: ['A:1'], outbox: [] });

test('dexie: receipt-write failure rolls back the replacement seed, retired originals and pending membership', async () => {
  const store = createDocumentDatabase({ databaseName: 'recovery-abort-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
  const session = await store.openSession(options);
  await store.commitBatch(session, initial());
  const put = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function(value, ...rest) {
      if (this.name === 'receipts' && value.batchId === 'adoption')
        throw new DOMException('Injected storage failure', 'QuotaExceededError');
      return put.call(this, value, ...rest);
    };
    await assert.rejects(store.commitBatch(session, adoption()), { name: 'QuotaExceededError' });
  } finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await store.readCheckpoint(session)).revision, 'r1');
  assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['A:1', 'A:2']);
  assert.deepEqual((await store.readOutbox(session)).map(row => row.id), ['A:1', 'A:2']);
  await store.commitBatch(session, adoption());
  assert.equal((await store.readCheckpoint(session)).revision, 'r2');
  await store.dispose();
});

for (const [kind, create] of [['dexie', createDocumentDatabase], ['memory', createMemoryDocumentStore]]) {
  async function opened() {
    const store = create({ databaseName: 'recovery-' + crypto.randomUUID(), acquireWriter: async () => () => {} });
    return { store, session: await store.openSession(options) };
  }

  test(kind + ': published-base adoption atomically retires only covered originals and pending membership', async () => {
    const { store, session } = await opened();
    await store.commitBatch(session, initial());
    await store.commitBatch(session, adoption());
    assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['A:2']);
    assert.deepEqual((await store.readOutbox(session)).map(row => row.id), ['A:2']);
    assert.equal((await store.readCheckpoint(session)).revision, 'r2');
    await store.dispose();
  });

  test(kind + ': exact receipt retry after certified retirement cannot recreate deleted originals or delivery', async () => {
    const { store, session } = await opened();
    const first = initial();
    await store.commitBatch(session, first);
    await store.commitBatch(session, adoption());
    assert.deepEqual(await store.commitBatch(session, first), { batchId: 'original', revision: 'r1' });
    assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['A:2']);
    assert.deepEqual((await store.readOutbox(session)).map(row => row.id), ['A:2']);
    const changed = structuredClone(first); changed.journal[0].payload[0]++;
    await assert.rejects(store.commitBatch(session, changed), { code: 'BatchConflict' });
    const changedRetirement = adoption(); changedRetirement.removeJournalIds = [];
    await assert.rejects(store.commitBatch(session, changedRetirement), { code: 'BatchConflict' });
    await store.dispose();
  });

  test(kind + ': first lifecycle binding can retire an origin without breaking an exact confirmed receipt', async () => {
    const { store, session } = await opened();
    const origin = '$origin:0123456789abcdef0123456789abcdef';
    const first = initial(); first.journal.unshift({ id: origin, payload: bytes('origin') });
    await store.commitBatch(session, first);
    const next = adoption(); next.recovery = { generation, revision: 0, clock: {} };
    next.removeJournalIds = [origin]; next.removeOutboxIds = [];
    await store.commitBatch(session, next);
    assert.deepEqual(await store.commitBatch(session, first), { batchId: 'original', revision: 'r1' });
    assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['A:1', 'A:2']);
    await store.dispose();
  });

  test(kind + ': uncertified retirement cannot mutate a checkpoint or discard an unarchived suffix', async () => {
    const { store, session } = await opened();
    await store.commitBatch(session, initial());
    for (const change of [
      value => { delete value.recovery; },
      value => { value.checkpoint.payload = new Uint8Array(); delete value.checkpoint.snapshotAfterJournalId; },
      value => { value.removeJournalIds = ['A:2']; },
      value => { value.removeOutboxIds = ['A:2']; },
      value => { value.recovery.clock = { A: 3 }; },
      value => { value.recovery.clock = { constructor: 1 }; value.removeJournalIds = []; value.removeOutboxIds = []; },
    ]) {
      const bad = adoption(); change(bad);
      await assert.rejects(store.commitBatch(session, bad), { code: 'InvalidCommitBatch' });
      assert.equal((await store.readCheckpoint(session)).revision, 'r1');
      assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['A:1', 'A:2']);
    }
    await store.dispose();
  });

  test(kind + ': recovery metadata is monotonic and bound to the document lifecycle', async () => {
    const { store, session } = await opened();
    await store.commitBatch(session, initial());
    await store.commitBatch(session, adoption());
    for (const recovery of [
      { generation, revision: 0, clock: {} },
      { generation, revision: 2, clock: {} },
      { generation: crypto.randomUUID(), revision: 2, clock: { A: 1 } },
      { generation, revision: 1, clock: { A: 2 } },
    ]) {
      const next = adoption(); next.batchId = crypto.randomUUID(); next.expectedRevision = 'r2';
      next.checkpoint.revision = 'r3'; next.recovery = recovery;
      next.removeJournalIds = []; next.removeOutboxIds = [];
      await assert.rejects(store.commitBatch(session, next), { code: 'StorageConflict' });
      assert.equal((await store.readCheckpoint(session)).revision, 'r2');
    }
    await store.dispose();
  });

  test(kind + ': explicit native branch abandonment can retire an incompatible post-archive stream', async () => {
    const { store, session } = await opened();
    await store.commitBatch(session, initial());
    const next = adoption(); next.recovery.abandonedBranch = true;
    next.checkpoint.clock = { A: 1 }; next.checkpoint.snapshotAfterJournalId = null;
    next.removeJournalIds = ['A:1', 'A:2']; next.removeOutboxIds = ['A:1', 'A:2'];
    await store.commitBatch(session, next);
    assert.deepEqual((await store.readRetainedJournal(session)).journal, []);
    assert.deepEqual(await store.readOutbox(session), []);
    assert.deepEqual((await store.readCheckpoint(session)).clock, { A: 1 });
    await store.dispose();
  });

  test(kind + ': clock retirement checks use own components when an author matches a prototype member', async () => {
    const { store, session } = await opened();
    const first = initial(); first.checkpoint.clock = { constructor: 2 };
    first.checkpoint.snapshotAfterJournalId = 'constructor:2';
    for (const record of [...first.journal, ...first.outbox]) record.id = record.id.replace('A:', 'constructor:');
    await store.commitBatch(session, first);
    const next = adoption(); next.checkpoint.clock = { constructor: 2 };
    next.checkpoint.snapshotAfterJournalId = 'constructor:2'; next.recovery.clock = { constructor: 1 };
    next.removeJournalIds = ['constructor:1']; next.removeOutboxIds = ['constructor:1'];
    await store.commitBatch(session, next);
    const rewind = structuredClone(next); rewind.batchId = 'rewind'; rewind.expectedRevision = 'r2'; rewind.checkpoint.revision = 'r3';
    rewind.recovery = { generation, revision: 2, clock: {} }; rewind.removeJournalIds = []; rewind.removeOutboxIds = [];
    await assert.rejects(store.commitBatch(session, rewind), { code: 'StorageConflict' });
    await store.dispose();
  });

  test(kind + ': a new batch cannot resurrect an original retired into the adopted checkpoint', async () => {
    const { store, session } = await opened();
    await store.commitBatch(session, initial());
    await store.commitBatch(session, adoption());
    const next = initial(); next.batchId = 'resurrection'; next.expectedRevision = 'r2'; next.checkpoint.revision = 'r3';
    await assert.rejects(store.commitBatch(session, next), { code: 'StorageConflict' });
    assert.deepEqual((await store.readRetainedJournal(session)).journal.map(row => row.id), ['A:2']);
    await store.dispose();
  });
}
