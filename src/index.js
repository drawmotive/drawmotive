const protocolVersion = 2;
const buttonIds = ['undo', 'redo', 'arrow', 'rectangle', 'ellipse', 'diamond', 'text', 'sketchyMode', 'zoomIn', 'zoomOut', 'resetZoom', 'settings', 'help'];
const moduleIds = ['analytics', 'authentication', 'remoteSync'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Runtime failures and uncertain deadlines retain machine-readable ownership. */
export class EditorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EditorError';
    this.code = code;
    Object.assign(this, details);
  }
}
function keys(value, allowed, name) {
  if (!record(value)) throw new TypeError(name + ' must be an object');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError('Unknown ' + name + ' option: ' + key);
}
function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(name + ' must be a boolean');
  return value;
}
function text(value, name) {
  if (typeof value !== 'string') throw new TypeError(name + ' must be a string');
  return value;
}
function positive(value, name, zero = false) {
  if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) throw new TypeError(name + ' must be finite and ' + (zero ? 'nonnegative' : 'positive'));
  return value;
}
function stateValue(value) {
  if (!record(value) || !['healthy', 'faulted'].includes(value.health)
      || !(typeof value.revision === 'string' || value.revision === null)
      || ['editingEnabled', 'busy', 'canUndo', 'canRedo'].some(key => typeof value[key] !== 'boolean')) {
    throw new EditorError('InvalidRuntimeResponse', 'Invalid editor state');
  }
  return Object.freeze({ revision: value.revision, health: value.health, editingEnabled: value.editingEnabled, busy: value.busy, canUndo: value.canUndo, canRedo: value.canRedo });
}
function runtimeError(value) {
  if (!record(value) || typeof value.code !== 'string' || typeof value.message !== 'string') return new EditorError('InvalidRuntimeResponse', 'Invalid structured editor error');
  return new EditorError(value.code, value.message);
}
function configuration(options) {
  keys(options, ['container', 'assetBaseUrl', 'frameDocument', 'ui', 'modules', 'signal', 'title', 'startupTimeoutMs', 'requestTimeoutMs', 'disposeTimeoutMs'], 'editor');
  const ui = options.ui ?? {};
  keys(ui, ['buttons', 'actions'], 'ui');
  const overrides = ui.buttons ?? {};
  keys(overrides, buttonIds, 'ui.buttons');
  const buttons = Object.fromEntries(buttonIds.map(id => [id, id !== 'help']));
  for (const [id, value] of Object.entries(overrides)) buttons[id] = boolean(value, 'ui.buttons.' + id);
  const handlers = new Map();
  if (ui.actions !== undefined && !Array.isArray(ui.actions)) throw new TypeError('ui.actions must be an array');
  const actions = (ui.actions ?? []).map(action => {
    keys(action, ['id', 'label', 'icon', 'visible', 'enabled', 'onInvoke'], 'action');
    if (typeof action.id !== 'string' || !/^host\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(action.id)) throw new TypeError('Action id must use the host. namespace');
    if (handlers.has(action.id)) throw new TypeError('Duplicate action id: ' + action.id);
    if (!text(action.label, 'Action label').trim()) throw new TypeError('Action label must not be empty');
    if (typeof action.onInvoke !== 'function') throw new TypeError('Action ' + action.id + ' requires an onInvoke handler');
    const descriptor = { id: action.id, label: action.label, visible: action.visible === undefined ? true : boolean(action.visible, 'Action visible'), enabled: action.enabled === undefined ? true : boolean(action.enabled, 'Action enabled') };
    if (action.icon !== undefined) descriptor.icon = text(action.icon, 'Action icon');
    handlers.set(action.id, action.onInvoke);
    return descriptor;
  });
  const modules = Object.fromEntries(moduleIds.map(id => [id, false]));
  keys(options.modules ?? {}, moduleIds, 'modules');
  for (const [id, value] of Object.entries(options.modules ?? {})) modules[id] = boolean(value, 'modules.' + id);
  if (modules.remoteSync && !modules.authentication) throw new TypeError('remoteSync requires authentication');
  return { wire: { ui: { buttons, actions }, modules }, handlers };
}
function snapshotOptions(options) {
  keys(options, ['formats', 'render', 'png'], 'snapshot');
  if (!Array.isArray(options.formats) || !options.formats.length || options.formats.some(format => !['raw', 'png', 'svg'].includes(format))
      || new Set(options.formats).size !== options.formats.length) throw new TypeError('formats must contain distinct raw, png or svg values');
  const args = { formats: [...options.formats] };
  if (options.png !== undefined) {
    if (!options.formats.includes('png')) throw new TypeError('PNG options require the png format');
    keys(options.png, ['embedDocument'], 'png');
    args.png = {};
    if (options.png.embedDocument !== undefined) args.png.embedDocument = boolean(options.png.embedDocument, 'png.embedDocument');
  }
  if (options.render !== undefined) {
    keys(options.render, ['scale', 'maxWidth', 'padding', 'roundSvgNumbers'], 'render');
    args.render = {};
    for (const key of ['scale', 'maxWidth', 'padding']) if (options.render[key] !== undefined) args.render[key] = positive(options.render[key], 'render.' + key, key === 'padding');
    if (options.render.roundSvgNumbers !== undefined) args.render.roundSvgNumbers = boolean(options.render.roundSvgNumbers, 'render.roundSvgNumbers');
  }
  return args;
}
function viewportOptions(options = {}) {
  keys(options, ['padding', 'minScale', 'maxScale'], 'viewport');
  const args = {};
  for (const key of ['padding', 'minScale', 'maxScale']) if (options[key] !== undefined) args[key] = positive(options[key], 'viewport.' + key, key === 'padding');
  if ((args.minScale ?? .2) > (args.maxScale ?? 1)) throw new TypeError('viewport.minScale must not exceed maxScale');
  return args;
}

/** One frame owns the document, DOM, .NET globals and frozen startup modules.
 * Window messages establish a private port; only that port carries document data. */
export async function createEditor(options = {}) {
  const { wire, handlers } = configuration(options);
  const { container, signal } = options;
  const hostDocument = container?.ownerDocument;
  const hostWindow = hostDocument?.defaultView;
  if (!hostWindow || !(container instanceof hostWindow.HTMLElement)) throw new TypeError('container must be an HTML element in a browser document');
  const deadlines = Object.fromEntries(['startup', 'request', 'dispose'].map(name => [name, positive(options[name + 'TimeoutMs'] ?? (name === 'dispose' ? 5000 : 120000), name + 'TimeoutMs')]));
  const title = options.title === undefined ? 'DrawMotive diagram editor' : text(options.title, 'title');
  if (typeof hostWindow.MessageChannel !== 'function') throw new TypeError('MessageChannel is required');
  const assetBase = new URL(options.assetBaseUrl ?? new URL('../generated/editor/', import.meta.url), hostDocument.baseURI);
  if (!['https:', 'http:'].includes(assetBase.protocol) || assetBase.username || assetBase.password) throw new TypeError('assetBaseUrl must be an HTTP(S) URL');
  signal?.throwIfAborted();
  if (!assetBase.pathname.endsWith('/')) assetBase.pathname += '/';
  assetBase.search = '';
  assetBase.hash = '';
  const documentOptions = options.frameDocument;
  if (documentOptions !== undefined) {
    keys(documentOptions, ['url', 'html'], 'frameDocument');
    text(documentOptions.html, 'frameDocument.html');
  }
  const frameUrl = documentOptions === undefined ? new URL('embed.html', assetBase) : new URL(documentOptions.url, hostDocument.baseURI);
  if (!['https:', 'http:'].includes(frameUrl.protocol) || frameUrl.username || frameUrl.password
      || (documentOptions && frameUrl.origin !== hostWindow.location.origin)) {
    throw new TypeError('frameDocument.url must be an HTTP(S) URL on the host origin');
  }
  const nonce = hostWindow.crypto.randomUUID();
  frameUrl.hash = new URLSearchParams({ nonce }).toString();
  const frame = hostDocument.createElement('iframe');
  frame.title = title;
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  frame.src = frameUrl.href;
  if (documentOptions) {
    // A host-provided bootstrap document retains its service worker controller.
    // srcdoc/about:blank cannot reliably load authenticated VS Code resources.
    frame.addEventListener('load', () => {
      try {
        const document = frame.contentDocument;
        document.open();
        // document.open inherits the parent's URL, including its hash. Restore
        // the authenticated nonce before any runtime module executes.
        frame.contentWindow.history.replaceState(null, '', frameUrl.href);
        document.write(documentOptions.html);
        document.close();
      } catch (error) { close(error); }
    }, { once: true });
  }
  let lifecycle = 'loading';
  let latestState;
  let sequence = 0;
  let port;
  let connected = false;
  let disposal;
  let resolveReady;
  let rejectReady;
  const listeners = new Set();
  const pending = new Map();
  const actions = new Map();
  const actionIds = new Set();
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const disposedError = () => new EditorError('EditorDisposed', 'Editor has been disposed');

  function updateState(value) {
    const next = stateValue(value);
    if (latestState && Object.keys(next).every(key => next[key] === latestState[key])) return;
    latestState = next;
    for (const listener of listeners) {
      try { listener(next); } catch (error) { hostWindow.console.error('Editor state listener failed', error); }
    }
  }
  function settle(entry, result, error) {
    clearTimeout(entry.timer);
    pending.delete(entry.id);
    entry.complete(error ? { error } : { result });
    if (!entry.timedOut) {
      if (error) entry.reject(error);
      else entry.resolve(result);
    }
  }
  function close(reason = disposedError()) {
    if (lifecycle === 'disposed') return;
    lifecycle = 'disposed';
    clearTimeout(startupTimer);
    hostWindow.removeEventListener('message', bootstrap);
    hostWindow.removeEventListener('pagehide', pagehide);
    signal?.removeEventListener('abort', abort);
    rejectReady(reason);
    for (const entry of [...pending.values()]) settle(entry, undefined, reason);
    for (const action of actions.values()) action.controller.abort(reason);
    actions.clear();
    actionIds.clear();
    handlers.clear();
    listeners.clear();
    if (port) { port.onmessage = null; port.onmessageerror = null; port.close(); }
    frame.remove();
  }
  function request(method, args = {}, timeoutMs = deadlines.request) {
    if (lifecycle !== 'ready') return Promise.reject(disposedError());
    return new Promise((resolve, reject) => {
      const id = String(++sequence);
      let complete;
      const completion = new Promise(done => { complete = done; });
      const entry = { id, resolve, reject, complete, timedOut: false, timer: undefined };
      entry.timer = setTimeout(() => {
        entry.timedOut = true;
        reject(new EditorError('RequestTimeoutUnknown', 'Editor ' + method + ' request timed out; its result is unknown', { requestId: id, method, completion }));
      }, timeoutMs);
      pending.set(id, entry);
      try { port.postMessage({ type: 'request', id, method, args }); }
      catch (error) { settle(entry, undefined, error); }
    });
  }
  function invoke(method, prepare) {
    try { return request(method, prepare()); }
    catch (error) { return Promise.reject(error); }
  }
  async function action(message) {
    if (typeof message.id !== 'string' || typeof message.actionId !== 'string' || actionIds.has(message.id)) return;
    actionIds.add(message.id);
    // Reverse RPC never holds the command queue. A Save handler may export or
    // even dispose this instance while its action invocation remains pending.
    const controller = new AbortController();
    actions.set(message.id, { controller });
    let error;
    try {
      if (lifecycle !== 'ready') throw new EditorError('ActionUnavailable', 'Editor is not ready for host actions');
      const handler = handlers.get(message.actionId);
      if (!handler) throw new EditorError('UnknownAction', 'Unknown host action: ' + message.actionId);
      await handler({ editor: instance, signal: controller.signal });
    } catch (failure) {
      error = { code: typeof failure?.code === 'string' ? failure.code : 'HostActionFailed', message: failure?.message ?? String(failure) };
    }
    if (lifecycle === 'ready' && !controller.signal.aborted) port.postMessage({ type: 'actionResult', id: message.id, result: null, ...(error ? { error } : {}) });
    actions.delete(message.id);
  }
  function receive(event) {
    const message = event.data;
    if (!record(message)) return;
    if (message.type === 'ready' && lifecycle === 'loading') {
      if (message.protocolVersion !== protocolVersion) { close(new EditorError('ProtocolMismatch', 'Unsupported editor runtime protocol')); return; }
      try { updateState(message.state); } catch (error) { close(error); return; }
      lifecycle = 'ready';
      clearTimeout(startupTimer);
      resolveReady();
    } else if (message.type === 'error') {
      const error = runtimeError(message.error);
      if (lifecycle === 'loading') close(error);
      else {
        for (const entry of [...pending.values()]) settle(entry, undefined, error);
        hostWindow.console.error(error);
      }
    } else if (message.type === 'response') {
      const entry = pending.get(message.id);
      if (!entry) return;
      let error = message.error === undefined ? undefined : runtimeError(message.error);
      if (message.state !== undefined) {
        try { updateState(message.state); } catch (failure) { error ??= failure; }
      }
      settle(entry, message.result, error);
    } else if (message.type === 'state' && lifecycle === 'ready') {
      try { updateState(message.state); } catch (error) { hostWindow.console.error(error); }
    } else if (message.type === 'action') void action(message);
  }
  function bootstrap(event) {
    if (connected || event.source !== frame.contentWindow || event.origin !== frameUrl.origin || event.data?.type !== 'drawmotive:hello') return;
    if (event.data.protocolVersion !== protocolVersion) { close(new EditorError('ProtocolMismatch', 'Unsupported editor runtime protocol')); return; }
    connected = true;
    const channel = new hostWindow.MessageChannel();
    port = channel.port1;
    port.onmessage = receive;
    port.onmessageerror = () => { if (lifecycle === 'loading') close(new EditorError('InvalidRuntimeResponse', 'Editor connection could not decode a message')); };
    port.start();
    try {
      frame.contentWindow.postMessage({ type: 'drawmotive:connect', protocolVersion, nonce, options: wire }, frameUrl.origin, [channel.port2]);
      hostWindow.removeEventListener('message', bootstrap);
    } catch (error) { channel.port2.close(); close(error); }
  }
  const abort = () => close(signal.reason ?? new DOMException('Initialization aborted', 'AbortError'));
  const pagehide = event => { if (!event.persisted) close(); };
  const startupTimer = setTimeout(() => close(new EditorError('StartupTimeout', 'Editor initialization timed out')), deadlines.startup);
  hostWindow.addEventListener('message', bootstrap);
  hostWindow.addEventListener('pagehide', pagehide);
  signal?.addEventListener('abort', abort, { once: true });

  const instance = Object.freeze({
    get lifecycle() { return lifecycle; },
    replaceDocument(raw) { return invoke('replaceDocument', () => ({ raw: text(raw, 'Document') })); },
    replacePngDocument(base64) { return invoke('replacePngDocument', () => ({ base64: text(base64, 'PNG document') })); },
    replaceTextGraph(source) { return invoke('replaceTextGraph', () => ({ source: text(source, 'TextGraph source') })); },
    clearDocument() { return request('clearDocument'); },
    exportSnapshot(options) { return invoke('exportSnapshot', () => snapshotOptions(options)); },
    fitViewport(options) { return invoke('fitViewport', () => viewportOptions(options)); },
    setEditingEnabled(enabled) { return invoke('setEditingEnabled', () => ({ enabled: boolean(enabled, 'enabled') })); },
    undo() { return request('undo'); },
    redo() { return request('redo'); },
    async getState() { const result = await request('getState'); updateState(result); return latestState; },
    onStateChanged(listener) {
      if (typeof listener !== 'function') throw new TypeError('State listener must be a function');
      if (lifecycle !== 'ready') throw disposedError();
      listeners.add(listener);
      try { listener(latestState); } catch (error) { listeners.delete(listener); throw error; }
      return () => { listeners.delete(listener); };
    },
    setActionState(id, value) {
      return invoke('setActionState', () => {
        if (!handlers.has(id)) throw new TypeError('Unknown host action: ' + id);
        keys(value, ['label', 'enabled', 'visible'], 'action state');
        const args = { id };
        if (value.label !== undefined) args.label = text(value.label, 'Action label');
        for (const key of ['enabled', 'visible']) if (value[key] !== undefined) args[key] = boolean(value[key], 'Action ' + key);
        return args;
      });
    },
    dispose() {
      if (disposal) return disposal;
      if (lifecycle === 'disposed') return Promise.resolve();
      for (const entry of [...pending.values()]) settle(entry, undefined, disposedError());
      for (const action of actions.values()) action.controller.abort(disposedError());
      const cleanup = request('dispose', {}, deadlines.dispose);
      lifecycle = 'disposing';
      disposal = cleanup.then(() => { close(); }, error => {
        close();
        throw new EditorError('DisposeCleanupUnconfirmed', 'Editor removed; runtime storage cleanup was not confirmed', { cause: error });
      });
      return disposal;
    },
  });
  container.append(frame);
  try {
    await ready;
    signal?.throwIfAborted();
    signal?.removeEventListener('abort', abort);
    return instance;
  } catch (error) { close(error); throw error; }
}
