import { EditorError } from '../errors.js';
import { createMemoryDocumentStore } from '../storage/memory-store.js';
import { createDocumentWorkerClient } from '../storage/worker-client.js';
import { createResourceWorkerClient } from '../resources/resource-worker-client.js';
import { createPreferenceStore } from './preferences.js';

export const PLATFORM_METHODS = Object.freeze(['storage.open', 'storage.read', 'storage.commit',
  'storage.delete', 'fonts.load', 'preferences.get', 'preferences.update']);
const identifier = value => typeof value === 'string' && !!value.trim();

/** Host configuration owns the one active document and its account namespace. */
export function createPlatformServices({ persistence, replication = false,
  workerFactory, workerUrls = {}, createDocumentStore, createResourceLoader, preferenceStore = createPreferenceStore() } = {}) {
  const mode = persistence?.mode ?? 'memory';
  if (!['memory', 'persistent'].includes(mode) || persistence && Object.keys(persistence).some(key => !['mode', 'namespace', 'documentId'].includes(key))
      || mode === 'persistent' && (!identifier(persistence.namespace) || !identifier(persistence.documentId)))
    throw new TypeError('Persistent storage requires an opaque namespace and documentId.');
  const options = Object.freeze({ persistence: mode,
    namespace: persistence?.namespace ?? 'temporary', documentId: persistence?.documentId ?? 'temporary' });
  let store, session, opening, resources, loadingResources, closing, disposed = false;
  const pending = new Set();
  const commitListeners = new Set();
  function track(action) {
    if (disposed) return Promise.reject(new EditorError('EditorDisposed', 'Editor platform services are closed.'));
    const operation = action(); pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => {});
    return operation;
  }
  async function open() {
    return opening ??= (async () => {
      store = createDocumentStore ? await createDocumentStore(options)
        : mode === 'memory' ? createMemoryDocumentStore()
        : await createDocumentWorkerClient({ workerFactory, url: workerUrls.document });
      session = await store.openSession(options);
      return session;
    })();
  }
  async function loadResources() {
    return loadingResources ??= (async () => resources = createResourceLoader ? await createResourceLoader()
      : await createResourceWorkerClient({ workerFactory, url: workerUrls.resource }))();
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
      case 'storage.commit': {
        const receipt = await store.commitBatch(session, args.batch);
        // Wakeups follow durable storage, independently of native command/state queues.
        // Observers have no authority over a successful save, including receipt retries.
        for (const listener of commitListeners) {
          try { void Promise.resolve(listener()).catch(() => {}); } catch { /* Delivery cannot reject persistence. */ }
        }
        return receipt;
      }
      case 'storage.delete': return store.deleteDocument(session);
    }
  }
  return Object.freeze({
    request: (method, args) => track(() => execute(method, args)),
    // Private composition only; never attached to the public editor handle.
    replication: replication ? Object.freeze({
      read: () => track(async () => { await open(); return store.readReplicationState(session); }),
      acknowledge: ids => {
        const copy = Array.isArray(ids) ? [...ids] : ids;
        return track(async () => { await open(); return store.acknowledgeOutbox(session, copy); });
      },
      onChanged(listener) {
        if (typeof listener !== 'function') throw new TypeError('A commit listener is required.');
        if (disposed) throw new EditorError('EditorDisposed', 'Editor platform services are closed.');
        commitListeners.add(listener); return () => commitListeners.delete(listener);
      },
    }) : undefined,
    dispose() {
      return closing ??= (async () => {
        disposed = true;
        commitListeners.clear();
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
