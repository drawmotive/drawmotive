/** A browser frame owns one complete editor runtime, including its document,
 * styles and .NET globals. Only the versioned message API crosses that boundary. */
export async function initializeEditor(options = {}) {
  const { container, signal, source, document: initialDocument } = options;
  const hostDocument = container?.ownerDocument;
  const hostWindow = hostDocument?.defaultView;
  if (!hostWindow || !(container instanceof hostWindow.HTMLElement)) {
    throw new TypeError('container must be an HTML element in a browser document');
  }
  if (source !== undefined && typeof source !== 'string') throw new TypeError('source must be a string');
  if (initialDocument !== undefined && typeof initialDocument !== 'string') throw new TypeError('document must be a base64 string');
  if (source !== undefined && initialDocument !== undefined) throw new TypeError('Pass source or document, not both');
  signal?.throwIfAborted();
  const parentOrigin = hostWindow.location.origin;
  if (parentOrigin === 'null') throw new Error('Serve the editor over HTTPS or localhost, not file://');
  const assetBase = new URL(options.assetBaseUrl ?? new URL('../generated/editor/', import.meta.url), hostDocument.baseURI);
  if (!['https:', 'http:'].includes(assetBase.protocol) || assetBase.username || assetBase.password) {
    throw new TypeError('assetBaseUrl must be an HTTP(S) URL');
  }
  if (!assetBase.pathname.endsWith('/')) assetBase.pathname += '/';
  assetBase.search = '';
  assetBase.hash = '';
  const frameUrl = new URL('embed.html', assetBase);
  const channel = hostWindow.crypto.randomUUID();
  frameUrl.hash = new URLSearchParams({ parentOrigin, channel }).toString();
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');

  const frame = hostDocument.createElement('iframe');
  frame.title = options.title ?? 'DrawMotive diagram editor';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  frame.src = frameUrl.href;
  let state = 'loading';
  let sequence = 0;
  let disposal;
  let resolveReady;
  let rejectReady;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  function close(reason = new Error('Editor has been disposed')) {
    if (state === 'disposed') return;
    state = 'disposed';
    clearTimeout(startupTimer);
    hostWindow.removeEventListener('message', receive);
    signal?.removeEventListener('abort', abort);
    rejectReady(reason);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    pending.clear();
    frame.remove();
  }

  function receive(event) {
    // Source and origin are both required: another frame on the same origin
    // must never resolve a request or inject a document into this instance.
    if (event.source !== frame.contentWindow || event.origin !== frameUrl.origin) return;
    const message = event.data;
    if (!message || message.channel !== channel) return;
    if (message.type === 'ready' && state === 'loading') {
      if (message.protocolVersion !== 1) {
        close(new Error('Unsupported editor runtime protocol; copy assets from the installed package'));
        return;
      }
      state = 'ready';
      clearTimeout(startupTimer);
      resolveReady();
    } else if (message.type === 'error') {
      close(new Error(typeof message.error === 'string' ? message.error : 'Editor failed to load'));
    } else if (message.type === 'response') {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(String(message.error)));
      else request.resolve(message.result);
    }
  }

  function request(method, payload) {
    if (state !== 'ready') return Promise.reject(new Error('Editor has been disposed'));
    return new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => close(new Error('Editor request timed out')), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      frame.contentWindow.postMessage({ channel, type: 'request', id, method, payload }, frameUrl.origin);
    });
  }

  const abort = () => close(signal.reason ?? new DOMException('Initialization aborted', 'AbortError'));
  const startupTimer = setTimeout(() => close(new Error('Editor initialization timed out')), timeoutMs);
  hostWindow.addEventListener('message', receive);
  signal?.addEventListener('abort', abort, { once: true });
  container.append(frame);

  const instance = Object.freeze({
    get state() { return state; },
    importTextGraph(text) {
      if (typeof text !== 'string') return Promise.reject(new TypeError('TextGraph source must be a string'));
      return request('importTextGraph', text);
    },
    importDocument(raw) {
      if (typeof raw !== 'string') return Promise.reject(new TypeError('Document must be a base64 string'));
      return request('importDocument', raw);
    },
    exportDocument() { return request('export'); },
    dispose() {
      if (disposal) return disposal;
      if (state === 'disposed') return Promise.resolve();
      for (const operation of pending.values()) {
        clearTimeout(operation.timer);
        operation.reject(new Error('Editor has been disposed'));
      }
      pending.clear();
      const cleanup = request('dispose');
      state = 'disposing';
      // Give the frame a chance to close its temporary storage. A crashed
      // runtime must not keep the host component mounted indefinitely.
      disposal = (async () => {
        let timer;
        try {
          await Promise.race([
            cleanup,
            new Promise(resolve => { timer = setTimeout(resolve, 2000); }),
          ]);
        } catch { /* Removal still releases a failed runtime. */ }
        finally { clearTimeout(timer); close(); }
      })();
      return disposal;
    },
  });
  try {
    await ready;
    if (source !== undefined) await instance.importTextGraph(source);
    else if (initialDocument !== undefined) await instance.importDocument(initialDocument);
    signal?.throwIfAborted();
    // The signal cancels initialization, including its initial import. Once
    // returned, the caller explicitly owns the instance through dispose().
    signal?.removeEventListener('abort', abort);
    return instance;
  } catch (error) {
    close(error);
    throw error;
  }
}
