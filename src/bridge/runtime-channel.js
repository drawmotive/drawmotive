import {
  EditorError, ERROR_CODES, assertProtocolMessage, createRequest, createResponse,
  createEvent, fromErrorDescriptor, immutableSnapshot, toErrorDescriptor,
} from './protocol.js';

const identifier = value => typeof value === 'string' && value.trim().length > 0;
const validSession = value => value === null || identifier(value);
const positive = value => Number.isFinite(value) && value > 0;
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

// Stop walking once the cache budget is exceeded, including large binary values.
function retainedSize(value, limit, visited = new WeakSet()) {
  if (typeof value === 'string') return value.length * 2;
  if (!value || typeof value !== 'object') return 8;
  if (visited.has(value)) return 0;
  visited.add(value);
  if (ArrayBuffer.isView(value)) return retainedSize(value.buffer, limit, visited);
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  let bytes = 0;
  const entries = value instanceof Map ? value.entries()
    : value instanceof Set ? [...value].map(item => [0, item])
    : value instanceof Error ? Object.getOwnPropertyNames(value).map(key => [key, value[key]])
    : Object.entries(value);
  for (const [key, item] of entries) {
    bytes += retainedSize(key, limit - bytes, visited) + retainedSize(item, limit - bytes, visited);
    if (bytes > limit) break;
  }
  return bytes;
}

/** A private port has one ordered document lane and an independent platform lane.
 * Reverse platform callbacks may issue document requests without holding that lane. */
export function createRuntimeChannel({ port, instanceId, documentSessionId = null, requestTimeoutMs = 120000, maxCachedResponses = 128, maxCachedResponseBytes = 1048576, onError } = {}) {
  if (!port || typeof port.postMessage !== 'function' || typeof port.addEventListener !== 'function' || typeof port.removeEventListener !== 'function') {
    throw new TypeError('A MessagePort-compatible transport is required');
  }
  if (!identifier(instanceId) || !validSession(documentSessionId)) throw new TypeError('A valid instance and document session are required');
  if (!positive(requestTimeoutMs)) throw new TypeError('requestTimeoutMs must be finite and positive');
  if (!nonnegativeInteger(maxCachedResponses) || !nonnegativeInteger(maxCachedResponseBytes)) throw new TypeError('Response cache limits must be nonnegative safe integers');
  if (onError !== undefined && typeof onError !== 'function') throw new TypeError('onError must be a function');
  const senderId = globalThis.crypto.randomUUID();
  const pending = new Map();
  const handlers = new Map();
  const listeners = new Map();
  const received = new Map();
  const activeDocumentRequests = new Set();
  const completed = new Map();
  let cachedBytes = 0;
  let session = documentSessionId;
  let sequence = 0;
  let disposed = false;
  let documentQueue = Promise.resolve();
  const disposedError = () => new EditorError(ERROR_CODES.EditorDisposed, 'Editor channel has been disposed');
  const staleError = () => new EditorError(ERROR_CODES.StaleDocumentSession, 'The document session has expired');
  const handlerKey = (lane, method) => lane + ':' + method;
  const requestKey = message => JSON.stringify([message.documentSessionId, message.lane, message.requestId]);
  const report = error => { try { onError?.(error); } catch { /* Reporting cannot stop delivery. */ } };

  function settle(entry, outcome) {
    if (!pending.delete(entry.message.requestId)) return;
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    entry.complete(outcome);
    if (!entry.waitEnded) {
      if (outcome.error) entry.reject(outcome.error);
      else entry.resolve(outcome.result);
    }
  }

  function stopWaiting(entry, code, message, cause) {
    if (!pending.has(entry.message.requestId) || entry.waitEnded) return;
    entry.waitEnded = true;
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    entry.reject(new EditorError(code, message, {
      requestId: entry.message.requestId, method: entry.message.method,
      instanceId, documentSessionId: entry.message.documentSessionId,
      completion: entry.completion, cause,
    }));
  }

  function post(message) {
    if (disposed) throw disposedError();
    port.postMessage(message);
  }

  function reply(entry, outcome) {
    if (disposed) return;
    let response;
    try {
      response = createResponse(entry.message, outcome);
    } catch (error) {
      response = createResponse(entry.message, { error: toErrorDescriptor(error) });
    }
    const key = requestKey(entry.message);
    received.delete(key);
    // Platform bytes are often large resources; durable batch IDs own storage
    // idempotency. Only small document responses get a bounded replay cache.
    if (entry.message.lane === 'document' && entry.message.documentSessionId === session && maxCachedResponses && maxCachedResponseBytes) {
      const bytes = retainedSize(response, maxCachedResponseBytes);
      if (bytes <= maxCachedResponseBytes) {
        completed.set(key, { response, bytes });
        cachedBytes += bytes;
        while (completed.size > maxCachedResponses || cachedBytes > maxCachedResponseBytes) {
          const oldest = completed.keys().next().value;
          cachedBytes -= completed.get(oldest).bytes;
          completed.delete(oldest);
        }
      }
    }
    try { post(response); } catch (error) { report(error); }
  }

  async function execute(entry) {
    const message = entry.message;
    if (disposed) return;
    if (message.documentSessionId !== session || entry.controller.signal.aborted) { reply(entry, { error: staleError() }); return; }
    const handler = handlers.get(handlerKey(message.lane, message.method));
    if (!handler) { reply(entry, { error: new EditorError(ERROR_CODES.UnknownMethod, 'Unknown editor method: ' + message.method) }); return; }
    if (message.lane === 'document') activeDocumentRequests.add(entry);
    try {
      const result = await handler(message.args, Object.freeze({
        instanceId, documentSessionId: message.documentSessionId, requestId: message.requestId,
        lane: message.lane, method: message.method, signal: entry.controller.signal,
      }));
      reply(entry, message.documentSessionId === session && !entry.controller.signal.aborted ? { result } : { error: staleError() });
    } catch (error) {
      reply(entry, { error: toErrorDescriptor(error, message.lane === 'platform' ? ERROR_CODES.HostActionFailed : ERROR_CODES.RuntimeError) });
    } finally {
      activeDocumentRequests.delete(entry);
    }
  }

  function receive(event) {
    if (disposed) return;
    let message;
    try { message = immutableSnapshot(assertProtocolMessage(event.data)); } catch (error) { report(error); return; }
    if (message.instanceId !== instanceId) return;
    if (message.type === 'response') {
      const entry = pending.get(message.requestId);
      if (!entry || message.documentSessionId !== entry.message.documentSessionId || message.documentSessionId !== session || message.lane !== entry.message.lane) return;
      settle(entry, 'error' in message ? { error: fromErrorDescriptor(message.error) } : { result: message.result });
    } else if (message.type === 'event') {
      if (message.documentSessionId !== session) return;
      for (const listener of listeners.get(message.name) ?? []) {
        try { listener(message.data, message); } catch (error) { report(error); }
      }
    } else {
      if (message.documentSessionId !== session) {
        try { post(createResponse(message, { error: staleError() })); } catch (error) { report(error); }
        return;
      }
      const key = requestKey(message);
      const existing = received.get(key);
      if (existing) return;
      const cached = completed.get(key);
      if (cached) {
        completed.delete(key);
        completed.set(key, cached);
        try { post(cached.response); } catch (error) { report(error); }
        return;
      }
      const entry = { message, controller: new AbortController() };
      received.set(key, entry);
      if (message.lane === 'platform') void execute(entry);
      else documentQueue = documentQueue.then(() => execute(entry)).catch(report);
    }
  }
  const decodeError = () => report(new EditorError(ERROR_CODES.InvalidRuntimeResponse, 'Editor connection could not decode a message'));
  port.addEventListener('message', receive);
  port.addEventListener('messageerror', decodeError);
  port.start?.();

  return Object.freeze({
    get instanceId() { return instanceId; },
    get documentSessionId() { return session; },
    get disposed() { return disposed; },
    request(method, args = {}, { lane = 'document', timeoutMs = requestTimeoutMs, signal, documentSafe } = {}) {
      if (disposed) return Promise.reject(disposedError());
      if (!positive(timeoutMs)) return Promise.reject(new TypeError('timeoutMs must be finite and positive'));
      if (documentSafe !== undefined && (typeof documentSafe !== 'boolean' || lane !== 'platform')) return Promise.reject(new TypeError('documentSafe must be a boolean on the platform lane'));
      if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) return Promise.reject(new TypeError('signal must be an AbortSignal'));
      if (signal?.aborted) return Promise.reject(new EditorError(ERROR_CODES.RequestAborted, 'Editor request was aborted', { cause: signal.reason }));
      if (lane === 'platform' && activeDocumentRequests.size && documentSafe !== true) {
        return Promise.reject(new EditorError(ERROR_CODES.ReverseCallDuringDocumentCommand, 'A document command may only await explicitly safe platform operations'));
      }
      return new Promise((resolve, reject) => {
        const requestId = senderId + ':' + ++sequence;
        const message = createRequest({ instanceId, documentSessionId: session, requestId, method, args, lane });
        let complete;
        const completion = new Promise(done => { complete = done; });
        const entry = { message, resolve, reject, complete, completion, signal, dispatched: false, waitEnded: false, timer: undefined, abort: undefined };
        entry.abort = () => {
          if (entry.dispatched) stopWaiting(entry, ERROR_CODES.RequestAbortedUnknown, 'Editor request waiting was aborted; its result is unknown', signal.reason);
          else settle(entry, { error: new EditorError(ERROR_CODES.RequestAborted, 'Editor request was aborted before dispatch', { requestId, method, instanceId, documentSessionId: message.documentSessionId, cause: signal.reason }) });
        };
        entry.timer = setTimeout(() => stopWaiting(entry, ERROR_CODES.RequestTimeoutUnknown, 'Editor ' + method + ' request timed out; its result is unknown'), timeoutMs);
        pending.set(requestId, entry);
        signal?.addEventListener('abort', entry.abort, { once: true });
        // Argument getters run during structuredClone and may synchronously abort.
        if (signal?.aborted) { entry.abort(); return; }
        entry.dispatched = true;
        try { post(message); } catch (error) { settle(entry, { error }); }
      });
    },
    onRequest(method, handler, { lane = 'document' } = {}) {
      if (disposed) throw disposedError();
      if (!identifier(method) || !['document', 'platform'].includes(lane) || typeof handler !== 'function') throw new TypeError('A valid method, lane and request handler are required');
      const key = handlerKey(lane, method);
      if (handlers.has(key)) throw new TypeError('An editor handler is already registered for ' + method);
      handlers.set(key, handler);
      return () => { if (handlers.get(key) === handler) handlers.delete(key); };
    },
    onEvent(name, listener) {
      if (disposed) throw disposedError();
      if (!identifier(name) || typeof listener !== 'function') throw new TypeError('A valid event name and listener are required');
      const group = listeners.get(name) ?? new Set();
      group.add(listener);
      listeners.set(name, group);
      return () => { group.delete(listener); if (!group.size && listeners.get(name) === group) listeners.delete(name); };
    },
    emit(name, data, { lane = 'document' } = {}) {
      post(createEvent({ instanceId, documentSessionId: session, name, data, lane }));
    },
    setDocumentSession(nextSession) {
      if (disposed) throw disposedError();
      if (!validSession(nextSession)) throw new TypeError('documentSessionId must be null or a nonempty string');
      if (nextSession === session) return;
      session = nextSession;
      const reason = staleError();
      for (const entry of [...pending.values()]) settle(entry, { error: reason });
      for (const entry of received.values()) entry.controller.abort(reason);
      received.clear();
      activeDocumentRequests.clear();
      completed.clear();
      cachedBytes = 0;
      // A stalled callback from an expired document cannot hold the new session.
      documentQueue = Promise.resolve();
    },
    dispose(reason = disposedError()) {
      if (disposed) return;
      disposed = true;
      for (const entry of [...pending.values()]) settle(entry, { error: reason });
      for (const entry of received.values()) entry.controller.abort(reason);
      received.clear();
      activeDocumentRequests.clear();
      completed.clear();
      cachedBytes = 0;
      handlers.clear();
      listeners.clear();
      port.removeEventListener('message', receive);
      port.removeEventListener('messageerror', decodeError);
      port.close?.();
    },
  });
}
