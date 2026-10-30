/// <reference lib="webworker" />
import { serveWorkerRequests } from '../../platform/worker-channel.js';
import { createDocumentDatabase } from './database';
declare const self: DedicatedWorkerGlobalScope;

let store: ReturnType<typeof createDocumentDatabase>;
// The dedicated Worker serializes every database operation, including disposal.
serveWorkerRequests(self, {
  initialize: ({ databaseName }: { databaseName?: string }) => { store = createDocumentDatabase({ databaseName }); return null; },
  'storage.open': options => store.openSession(options),
  'storage.read': ({ session }) => store.readCheckpoint(session),
  'storage.commit': ({ session, batch }) => store.commitBatch(session, batch),
  'storage.ack': ({ session, ids }) => store.acknowledgeOutbox(session, ids),
  'storage.outbox': ({ session }) => store.readOutbox(session),
  'storage.closeSession': ({ session }) => store.closeSession(session),
  'storage.delete': ({ session }) => store.deleteDocument(session),
  'storage.dispose': () => store.dispose(),
});
