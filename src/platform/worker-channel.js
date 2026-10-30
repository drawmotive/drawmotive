import { EditorError, toErrorDescriptor } from '../bridge/protocol.js';
import { createWorkerFactory } from './worker-factory.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** A Dedicated Worker already has one private parent channel. Own it until disposal;
 * mutation deadlines retain completion ownership because a write may have committed. */
export async function createWorkerChannel({ url, timeoutMs = 120000, workerFactory = createWorkerFactory(),
  name, connectData = {}, failureCode = 'WorkerFailed' }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('A positive Worker request timeout is required.');
  const handle = await workerFactory(url, { name });
  const pending = new Map();
  let sequence = 0, disposed = false;
  function settle(id, outcome) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id); clearTimeout(request.timer);
    request.complete(outcome);
    if (outcome.error) request.reject(new EditorError(outcome.error.code, outcome.error.message));
    else request.resolve(outcome.result);
  }
  function dispose(reason = new EditorError('EditorDisposed', 'Editor Worker is closed.')) {
    if (disposed) return;
    disposed = true;
    for (const id of pending.keys()) settle(id, { error: toErrorDescriptor(reason) });
    try {
      handle.worker.removeEventListener?.('message', received);
      handle.worker.removeEventListener?.('error', crashed);
      handle.worker.removeEventListener?.('messageerror', crashed);
    } finally { handle.dispose(); }
  }
  function received(event) {
    const value = event.data;
    if (!value || !pending.has(value.id)) return;
    if (own(value, 'result') === own(value, 'error') || own(value, 'error') &&
      (!value.error || typeof value.error.code !== 'string' || typeof value.error.message !== 'string')) {
      settle(value.id, { error: { code: 'InvalidRuntimeResponse', message: 'Invalid Worker response.' } });
      return;
    }
    settle(value.id, own(value, 'error') ? { error: value.error } : { result: value.result });
  }
  function crashed(event) {
    dispose(new EditorError(failureCode, event.message ?? 'Editor Worker failed; pending results are unconfirmed.'));
  }
  const channel = Object.freeze({
    get disposed() { return disposed; },
    request(method, args = {}, options = {}) {
      if (disposed) return Promise.reject(new EditorError('EditorDisposed', 'Editor Worker is closed.'));
      const deadline = options.timeoutMs ?? timeoutMs;
      if (typeof method !== 'string' || !method || !Number.isFinite(deadline) || deadline <= 0)
        return Promise.reject(new TypeError('A Worker method and positive timeout are required.'));
      const id = ++sequence;
      let complete;
      const completion = new Promise(resolve => { complete = resolve; });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new EditorError('RequestTimeoutUnknown', 'Worker request timed out; completion is unconfirmed.',
          { method, requestId: id, completion })), deadline);
        pending.set(id, { resolve, reject, timer, complete });
        try { handle.worker.postMessage({ id, method, args }); }
        catch (error) { settle(id, { error: toErrorDescriptor(error) }); }
      });
    },
    dispose,
  });
  try {
    handle.worker.addEventListener('message', received);
    handle.worker.addEventListener('error', crashed);
    handle.worker.addEventListener('messageerror', crashed);
    await channel.request('initialize', connectData);
    return Object.freeze({ channel, dispose });
  } catch (error) { dispose(error); throw error; }
}

/** Worker-side dispatch is ordered for document transactions. The independent font
 * Worker opts into concurrency and drains its active loads before closing.
 * @param {{ addEventListener: Function, removeEventListener: Function, postMessage: Function }} scope
 * @param {Record<string, (args: any) => any>} handlers
 */
export function serveWorkerRequests(scope, handlers, { concurrent = false } = {}) {
  let tail = Promise.resolve();
  async function execute({ id, method, args }) {
    try {
      if (!own(handlers, method)) throw new EditorError('UnknownMethod', 'Unknown Worker method: ' + method);
      scope.postMessage({ id, result: await handlers[method](args) });
    } catch (error) { scope.postMessage({ id, error: toErrorDescriptor(error) }); }
  }
  function received(event) {
    const request = event.data;
    if (!Number.isSafeInteger(request?.id) || request.id < 1 || typeof request.method !== 'string') return;
    if (concurrent) void execute(request);
    else tail = tail.then(() => execute(request));
  }
  scope.addEventListener('message', received);
  return () => scope.removeEventListener('message', received);
}
