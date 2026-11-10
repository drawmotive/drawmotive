import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { IDBObjectStore } from 'fake-indexeddb';
import { databaseName } from '../src/storage/worker/schema.ts';
import { createDocumentDatabase } from '../src/storage/worker/database.ts';
import { createMemoryDocumentStore } from '../src/storage/memory-store.js';
const configuration={namespace:'account-a',documentId:'drawing',persistence:'persistent'};
const asset=async text=>{const data=new TextEncoder().encode(text);return {hash:Buffer.from(await crypto.subtle.digest('SHA-256',data)).toString('hex'),data};};
const batch=(assets=[])=>({batchId:'first',expectedRevision:null,checkpoint:{revision:'r1',payload:Uint8Array.of(1),clock:{a:1},snapshotAfterJournalId:null},outbox:[{id:'a:1',revision:'r1',payload:Uint8Array.of(2)}],assets});
for(const [kind,create] of [['memory',createMemoryDocumentStore],['dexie',createDocumentDatabase]]) {
 const open=async t=>{const store=create({databaseName:'assets-'+crypto.randomUUID(),acquireWriter:async()=>()=>{}});t.after(()=>store.dispose());const session=await store.openSession(configuration);return {store,session};};
 test(`${kind}: image assets commit atomically, survive ACK and reject changed retry bytes`,async t=>{
  const {store,session}=await open(t),image=await asset('original pixels'),request=batch([image]);
  await store.commitBatch(session,request);assert.deepEqual(await store.readAssets(session),[image]);
  await store.acknowledgeOutbox(session,['a:1']);await store.commitBatch(session,request);
  assert.deepEqual(await store.readOutbox(session),[]);
  const changed=structuredClone(request);changed.assets=[await asset('different pixels')];
  await assert.rejects(store.commitBatch(session,changed),{code:'BatchConflict'});
  const invalid=batch([await asset('never committed')]);invalid.batchId='invalid';invalid.expectedRevision='wrong';
  await assert.rejects(store.commitBatch(session,invalid),{code:'StorageConflict'});
  assert.deepEqual(await store.readAssets(session),[image]);
 });
 test(`${kind}: resource-only writes preserve revision and own input and output buffers`,async t=>{
  const {store,session}=await open(t),image=await asset('pixels');
  const value=structuredClone(image),writing=store.writeAssets(session,[value]);value.data[0]=0;await writing;
  assert.equal(await store.readCheckpoint(session),null);assert.deepEqual(await store.readReplicationState(session),{clock:{},outbox:[],snapshotKey:'origin'});
  const read=await store.readAssets(session,[image.hash]);read[0].data[0]=0;
  assert.deepEqual(await store.readAssets(session,null),[image]);assert.deepEqual(await store.readAssets(session,['a'.repeat(64)]),[]);
  await store.writeAssets(session,[image]);assert.deepEqual(await store.readAssets(session),[image]);
  await store.commitBatch(session,batch());const before=await store.readCheckpoint(session);
  await store.writeAssets(session,[await asset('another')]);assert.deepEqual(await store.readCheckpoint(session),before);
 });
 test(`${kind}: malformed assets cannot partially commit data and expired leases cannot access assets`,async t=>{
  const {store,session}=await open(t),image=await asset('pixels');
  for(const invalid of [{...image,hash:'invalid'},{...image,data:Uint8Array.of(8)},{...image,data:new Uint8Array()},image]) {
   const assets=invalid===image?[image,image]:[image,invalid];
   await assert.rejects(store.commitBatch(session,batch(assets)),{code:'InvalidImageAsset'});
   assert.equal(await store.readCheckpoint(session),null);assert.deepEqual(await store.readAssets(session),[]);
  }
  await store.writeAssets(session,[image]);
  await assert.rejects(store.readAssets({...session,leaseId:'expired'}),{code:'StaleDocumentSession'});
  await assert.rejects(store.writeAssets({...session,documentId:'other'},[image]),{code:'StaleDocumentSession'});
  await store.deleteDocument(session);assert.deepEqual(await store.readAssets(session),[]);
  await store.closeSession(session);
  const other=await store.openSession({...configuration,namespace:'account-b'});assert.deepEqual(await store.readAssets(other),[]);
 });
}
test('persistent image assets survive close/reopen without entering another account or document',async t=>{
 const name='reopen-assets-'+crypto.randomUUID(),create=()=>createDocumentDatabase({databaseName:name,acquireWriter:async()=>()=>{}});
 let store=create();t.after(()=>store.dispose());let session=await store.openSession(configuration);const image=await asset('durable');
 await store.writeAssets(session,[image]);await store.dispose();store=create();session=await store.openSession(configuration);
 assert.deepEqual(await store.readAssets(session),[image]);await store.closeSession(session);
 session=await store.openSession({...configuration,documentId:'another'});assert.deepEqual(await store.readAssets(session),[]);
});

const rawName = prefix => databaseName(prefix, JSON.stringify([configuration.namespace, configuration.documentId]));
async function openRaw(name) { const db = new Dexie(name); await db.open(); return db; }

test('asset schema upgrade preserves an existing checkpoint and its original exact receipt', async t => {
  const prefix = 'legacy-assets-' + crypto.randomUUID(), old = new Dexie(rawName(prefix));
  old.version(1).stores({ meta:'key', snapshots:'id', journal:'id, &ordinal', outbox:'id', pending:'id, &ordinal', receipts:'batchId' });
  await old.open();
  const request = batch(); delete request.assets;
  await old.table('meta').put({ key:'head', checkpoint:{ revision:'r1', clock:{a:1}, snapshotAfterJournalId:null },
    snapshotId:'current', snapshotOrdinal:-1, nextJournalOrdinal:0, nextOutboxOrdinal:1 });
  await old.table('snapshots').put({ id:'current', payload:request.checkpoint.payload });
  await old.table('outbox').put(request.outbox[0]);
  // Digest was produced by the pre-assets schema, including an acknowledged outbox record.
  await old.table('receipts').put({ batchId:'first', revision:'r1', digest:'f9876678169b9ffd769b86f987f1dffd290a012cf7f90c71c9bd7491c469b832' });
  old.close();
  const store = createDocumentDatabase({ databaseName:prefix, acquireWriter:async()=>()=>{} });
  t.after(() => store.dispose()); const session = await store.openSession(configuration);
  assert.deepEqual(await store.commitBatch(session, request), { batchId:'first', revision:'r1' });
  assert.deepEqual(await store.readOutbox(session), []);
  assert.deepEqual(await store.readAssets(session), []);
  assert.deepEqual((await store.readCheckpoint(session)).payload, request.checkpoint.payload);
});

test('a persistent asset write failure rolls back checkpoint, journal, outbox and receipt together', async t => {
  const store = createDocumentDatabase({ databaseName:'asset-rollback-'+crypto.randomUUID(), acquireWriter:async()=>()=>{} });
  t.after(() => store.dispose()); const session = await store.openSession(configuration), image = await asset('pixels');
  const request = batch([image]); request.journal = [{ id:'a:1', payload:Uint8Array.of(2) }];
  const original = IDBObjectStore.prototype.put;
  const intercepted = t.mock.method(IDBObjectStore.prototype, 'put', function(...args) {
    if (this.name === 'assets') throw new DOMException('Asset quota exceeded.', 'QuotaExceededError');
    return original.apply(this, args);
  });
  await assert.rejects(store.commitBatch(session, request), { name:'QuotaExceededError' });
  assert.equal(await store.readCheckpoint(session), null);
  assert.deepEqual(await store.readRetainedJournal(session), { revision:null, clock:{}, journal:[] });
  assert.deepEqual(await store.readOutbox(session), []);
  assert.deepEqual(await store.readAssets(session), []);
  intercepted.mock.restore();
  assert.deepEqual(await store.commitBatch(session, request), { batchId:'first', revision:'r1' });
});

test('persistent exact receipts reject missing and corrupted immutable image evidence', async t => {
  const prefix = 'asset-receipt-'+crypto.randomUUID();
  const store = createDocumentDatabase({ databaseName:prefix, acquireWriter:async()=>()=>{} });
  t.after(() => store.dispose()); const session = await store.openSession(configuration), image = await asset('pixels'), request = batch([image]);
  await store.commitBatch(session, request);
  const raw = await openRaw(rawName(prefix)); t.after(() => raw.close());
  await raw.table('assets').delete(image.hash);
  await assert.rejects(store.commitBatch(session, request), { code:'StorageUnavailable' });
  await raw.table('assets').put({ ...image, data:Uint8Array.of(99) });
  await assert.rejects(store.commitBatch(session, request), { code:'StorageUnavailable' });
  await assert.rejects(store.writeAssets(session, [image]), { code:'BatchConflict' });
});
