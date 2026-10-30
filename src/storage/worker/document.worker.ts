/// <reference lib="webworker" />
import { createRuntimeChannel } from '../../bridge/runtime-channel.js';
import { PROTOCOL_VERSION } from '../../bridge/protocol.js';
import { createDocumentDatabase } from './database';
declare const self: DedicatedWorkerGlobalScope;

let connected = false;
self.addEventListener('message', event => {
  const message = event.data;
  if (connected || message?.type !== 'drawmotive:document-connect' || message.protocolVersion !== PROTOCOL_VERSION || !message.port) return;
  connected = true;
  const store = createDocumentDatabase({ databaseName: message.databaseName });
  const channel = createRuntimeChannel({ port: message.port, instanceId: message.instanceId, documentSessionId: message.documentSessionId });
  // All DB operations, including close, execute in one ordered lane. Reverse calls
  // from C# use the outer platform lane and cannot deadlock its document operation.
  channel.onRequest('storage.open', async (options: any) => {
    if (options.instanceId !== message.instanceId || options.documentSessionId !== message.documentSessionId || options.persistence !== 'persistent')
      throw Object.assign(new Error('Invalid Worker session identity.'), { code: 'InvalidDocumentSession' });
    return store.openSession(options);
  });
  channel.onRequest('storage.read', ({ session }: any) => store.readCheckpoint(session));
  channel.onRequest('storage.commit', ({ session, batch }: any) => store.commitBatch(session, batch));
  channel.onRequest('storage.ack', ({ session, ids }: any) => store.acknowledgeOutbox(session, ids));
  channel.onRequest('storage.outbox', ({ session }: any) => store.readOutbox(session));
  channel.onRequest('storage.closeSession', ({ session }: any) => store.closeSession(session));
  channel.onRequest('storage.delete', ({ session }: any) => store.deleteDocument(session));
  channel.onRequest('storage.dispose', () => store.dispose());
});
