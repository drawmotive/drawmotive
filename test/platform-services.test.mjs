import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformServices } from '../src/platform/services.js';

const checkpoint = { revision: 'v1', payload: new Uint8Array([1, 2, 3]), clock: { author: 1 } };

test('private replication wakes only after successful storage and reads/ACKs without an engine callback', async () => {
  const services = createPlatformServices({ replication: true });
  const seen = [];
  const stop = services.replication.onChanged(() => { seen.push(services.replication.read()); throw new Error('Observer failure'); });
  const batch = { batchId: 'batch-1', expectedRevision: null, checkpoint, outbox: [{ id: 'author:1', revision: 'v1', payload: new Uint8Array([9]) }] };
  await services.request('storage.commit', { batch });
  assert.equal(seen.length, 1);
  assert.deepEqual((await seen[0]).clock, { author: 1 });
  await assert.rejects(services.request('storage.commit', { batch: { ...batch, batchId: 'bad', expectedRevision: null } }), { code: 'StorageConflict' });
  assert.equal(seen.length, 1);
  await services.replication.acknowledge(['author:1']);
  assert.deepEqual(await services.replication.read(), { clock: { author: 1 }, outbox: [] });
  assert.deepEqual(await services.request('storage.read'), checkpoint);
  stop(); await services.dispose();
  await assert.rejects(services.replication.read(), { code: 'EditorDisposed' });
});

test('standalone storage has no registered replication capability and saves without outgoing records', async () => {
  const services = createPlatformServices();
  assert.equal(services.replication, undefined);
  await services.request('storage.commit', { batch: { batchId: 'one', expectedRevision: null, checkpoint, outbox: [] } });
  assert.deepEqual(await services.request('storage.read'), checkpoint);
  await services.dispose();
});

test('temporary storage uses a single host-owned document and releases memory on disposal', async () => {
  const services = createPlatformServices();
  const session = await services.request('storage.open', { namespace: 'untrusted', documentId: 'other' });
  assert.equal('instanceId' in session, false);
  assert.equal('documentSessionId' in session, false);
  assert.equal(session.namespace, 'temporary');
  assert.equal(session.documentId, 'temporary');
  assert.equal(session.persistence, 'memory');
  await services.request('storage.commit', { batch: { batchId: 'batch-1', expectedRevision: null, checkpoint, outbox: [] } });
  assert.deepEqual(await services.request('storage.read'), checkpoint);
  await services.dispose();
  await services.dispose();
  await assert.rejects(services.request('storage.read'), { code: 'EditorDisposed' });
});

test('persistent ownership opens once; dispose preserves the document', async () => {
  const calls = [];
  const session = { namespace: 'user:1', documentId: 'doc:1', persistence: 'persistent', leaseId: 'lease' };
  const store = {
    async openSession(options) { calls.push(['open', options]); return session; },
    async readCheckpoint(value) { calls.push(['read', value]); return checkpoint; },
    async closeSession(value) { calls.push(['close', value]); },
    async deleteDocument() { assert.fail('Dispose must preserve persistent documents'); },
    async dispose() { calls.push(['dispose']); },
  };
  const services = createPlatformServices({
    persistence: { mode: 'persistent', namespace: 'user:1', documentId: 'doc:1' },
    createDocumentStore: async () => store,
  });
  await Promise.all([services.request('storage.open'), services.request('storage.read')]);
  await services.dispose();
  assert.deepEqual(calls.map(value => value[0]), ['open', 'read', 'close', 'dispose']);
  assert.deepEqual(calls[0][1], { namespace: 'user:1', documentId: 'doc:1', persistence: 'persistent' });
});

test('font Worker is separate, lazy and releases after a failed resource request', async () => {
  let created = 0, disposed = 0;
  const services = createPlatformServices({ createResourceLoader: async () => {
    created++;
    return { async load() { throw Object.assign(new Error('Offline'), { code: 'ResourceUnavailable' }); }, async dispose() { disposed++; } };
  } });
  assert.equal(created, 0);
  await assert.rejects(services.request('fonts.load', { path: 'font.ttf' }), { code: 'ResourceUnavailable' });
  await services.dispose();
  assert.equal(created, 1);
  assert.equal(disposed, 1);
});

test('failed startup is owned and disposal releases an acquired store', async () => {
  let disposed = 0;
  const services = createPlatformServices({
    persistence: { mode: 'persistent', namespace: 'account', documentId: 'drawing' },
    createDocumentStore: async () => ({ async openSession() { throw new Error('Already open'); }, async dispose() { disposed++; } }),
  });
  await assert.rejects(services.request('storage.open'), /Already open/);
  await services.dispose();
  assert.equal(disposed, 1);
});

test('unknown methods and invalid storage options fail before creating services', async () => {
  assert.throws(() => createPlatformServices({ persistence: { mode: 'persistent' } }), TypeError);
  const services = createPlatformServices();
  await assert.rejects(services.request('raw.query', { sql: 'all' }), { code: 'UnknownMethod' });
  await services.dispose();
});

test('preferences bypass document storage and belong to the host', async () => {
  const values = new Map();
  const { createPreferenceStore } = await import('../src/platform/preferences.js');
  const preferenceStore = createPreferenceStore({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  const services = createPlatformServices({ preferenceStore,
    createDocumentStore() { assert.fail('Appearance preferences must not open a document store'); },
  });
  assert.deepEqual(await services.request('preferences.get'), {});
  assert.deepEqual(await services.request('preferences.update', { darkTheme: true }), { darkTheme: true });
  await services.dispose();
  assert.deepEqual(await preferenceStore.read(), { darkTheme: true });
  await assert.rejects(services.request('preferences.get'), { code: 'EditorDisposed' });
});
