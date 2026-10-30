import { EditorError } from '../bridge/protocol.js';
import { createMemoryDocumentStore } from '../storage/memory-store.js';
import { createDocumentWorkerClient } from '../storage/worker-client.js';
import { createResourceWorkerClient } from '../resources/resource-worker-client.js';
import { createPreferenceStore } from './preferences.js';

export const PLATFORM_METHODS = Object.freeze(['storage.open', 'storage.read', 'storage.commit',
  'storage.ack', 'storage.outbox', 'storage.delete', 'fonts.load', 'preferences.get', 'preferences.update']);
const identifier = value => typeof value === 'string' && !!value.trim();

/** Host configuration owns storage identity; the frame cannot select another account.
 * One instance owns one document session. Opening a different document creates a
 * new editor instance, keeping old callbacks and leases outside the new session. */
export function createPlatformServices({ instanceId, documentSessionId, persistence,
  workerFactory, workerUrls = {}, createDocumentStore, createResourceLoader, preferenceStore = createPreferenceStore() } = {}) {
  if (!identifier(instanceId) || !identifier(documentSessionId)) throw new TypeError('Editor identities are required.');
  const mode = persistence?.mode ?? 'memory';
  if (!['memory', 'persistent'].includes(mode) || persistence && Object.keys(persistence).some(key => !['mode', 'namespace', 'documentId'].includes(key))
      || mode === 'persistent' && (!identifier(persistence.namespace) || !identifier(persistence.documentId)))
    throw new TypeError('Persistent storage requires an opaque namespace and documentId.');
  const options = Object.freeze({ instanceId, documentSessionId, persistence: mode,
    namespace: persistence?.namespace ?? 'temporary', documentId: persistence?.documentId ?? documentSessionId });
  let store, session, opening, resources, loadingResources, closing, disposed = false;
  const pending = new Set();
  async function open() {
    return opening ??= (async () => {
      store = createDocumentStore ? await createDocumentStore(options)
        : mode === 'memory' ? createMemoryDocumentStore()
        : await createDocumentWorkerClient({ instanceId, documentSessionId, workerFactory, url: workerUrls.document });
      session = await store.openSession(options);
      return session;
    })();
  }
  async function loadResources() {
    return loadingResources ??= (async () => resources = createResourceLoader ? await createResourceLoader()
      : await createResourceWorkerClient({ instanceId, workerFactory, url: workerUrls.resource }))();
  }
  async function execute(method, args = {}) {
    if (method === 'fonts.load') return (await loadResources()).load(args);
    if (method === 'preferences.get') return preferenceStore.read();
    if (method === 'preferences.update') return preferenceStore.update(args);
    if (!PLATFORM_METHODS.includes(method)) throw new EditorError('UnknownMethod', 'Unknown platform method: ' + method);
    await open();
    switch (method) {
      case 'storage.open': return session;
      case 'storage.read': return store.readCheckpoint(session);
      case 'storage.commit': return store.commitBatch(session, args.batch);
      case 'storage.ack': return store.acknowledgeOutbox(session, args.ids);
      case 'storage.outbox': return store.readOutbox(session);
      case 'storage.delete': return store.deleteDocument(session);
    }
  }
  return Object.freeze({
    request(method, args) {
      if (disposed) return Promise.reject(new EditorError('EditorDisposed', 'Editor platform services are closed.'));
      const operation = execute(method, args);
      pending.add(operation);
      void operation.finally(() => pending.delete(operation)).catch(() => {});
      return operation;
    },
    dispose() {
      return closing ??= (async () => {
        disposed = true;
        await Promise.allSettled([...pending]);
        const outcomes = await Promise.allSettled([
          (async () => { try { if (session) await store.closeSession(session); } finally { await store?.dispose?.(); } })(),
          resources?.dispose(),
        ]);
        const failed = outcomes.find(outcome => outcome.status === 'rejected');
        if (failed) throw failed.reason;
      })();
    },
  });
}
