import { PROTOCOL_VERSION, EditorError, fromErrorDescriptor } from './bridge/protocol.js';
import { createRuntimeChannel } from './bridge/runtime-channel.js';
import { normalizeUiOptions } from './react/ui-options-runtime.js';
import { createPlatformServices, PLATFORM_METHODS } from './platform/services.js';
import { createPreferenceStore, validatePreferences } from './platform/preferences.js';
import { createEditorClipboard } from './platform/clipboard.js';
export { EditorError };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
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
  return Object.freeze({ revision: value.revision, health: value.health, editingEnabled: value.editingEnabled, busy: value.busy, canUndo: value.canUndo, canRedo: value.canRedo, ...(value.tool === undefined ? {} : { tool: value.tool }), ...(value.zoom === undefined ? {} : { zoom: value.zoom }), ...(value.sketchyMode === undefined ? {} : { sketchyMode: value.sketchyMode }) });
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


/** A frame owns one document session, its .NET globals and native editing DOM.
 * Open another logical document by disposing this instance and creating another. */
export async function createEditor(options = {}) {
  keys(options, ['container','assetBaseUrl','frameDocument','ui','persistence','workerFactory','workerUrls','signal','title','startupTimeoutMs','requestTimeoutMs','disposeTimeoutMs'], 'editor');
  const normalized = normalizeUiOptions(options.ui);
  let ui = normalized.ui;
  const handlers = normalized.handlers;
  const { container, signal } = options;
  const hostDocument = container?.ownerDocument, hostWindow = hostDocument?.defaultView;
  if (!hostWindow || !(container instanceof hostWindow.HTMLElement)) throw new TypeError('container must be an HTML element in a browser document');
  const deadlines = Object.fromEntries(['startup','request','dispose'].map(name => [name, positive(options[name + 'TimeoutMs'] ?? (name === 'dispose' ? 5000 : 120000), name + 'TimeoutMs')]));
  const title = options.title === undefined ? 'DrawMotive diagram editor' : text(options.title, 'title');
  if (typeof hostWindow.MessageChannel !== 'function') throw new TypeError('MessageChannel is required');
  if (options.workerFactory !== undefined && typeof options.workerFactory !== 'function') throw new TypeError('workerFactory must be a function');
  if (options.workerUrls !== undefined) keys(options.workerUrls, ['document','resource'], 'workerUrls');
  const assetBase = new URL(options.assetBaseUrl ?? new URL('../generated/editor/', import.meta.url), hostDocument.baseURI);
  if (!['https:','http:'].includes(assetBase.protocol) || assetBase.username || assetBase.password) throw new TypeError('assetBaseUrl must be an HTTP(S) URL');
  if (!assetBase.pathname.endsWith('/')) assetBase.pathname += '/'; assetBase.search = ''; assetBase.hash = '';
  const documentOptions = options.frameDocument;
  if (documentOptions !== undefined) { keys(documentOptions, ['url','html'], 'frameDocument'); text(documentOptions.html, 'frameDocument.html'); }
  const frameUrl = documentOptions === undefined ? new URL('embed.html', assetBase) : new URL(documentOptions.url, hostDocument.baseURI);
  if (!['https:','http:'].includes(frameUrl.protocol) || frameUrl.username || frameUrl.password || documentOptions && frameUrl.origin !== hostWindow.location.origin)
    throw new TypeError('frameDocument.url must be an HTTP(S) URL on the host origin');
  signal?.throwIfAborted();
  const instanceId = hostWindow.crypto.randomUUID(), documentSessionId = hostWindow.crypto.randomUUID();
  const platform = createPlatformServices({ instanceId, documentSessionId, persistence: options.persistence, workerFactory: options.workerFactory, workerUrls: options.workerUrls,
    preferenceStore: createPreferenceStore({ storage: {
      // Resolve lazily: denied localStorage must fail the preference operation,
      // rather than leaking an unowned frame during createEditor.
      getItem: key => hostWindow.localStorage.getItem(key),
      setItem: (key,value) => hostWindow.localStorage.setItem(key,value),
    } }),
  });
  const nonce = hostWindow.crypto.randomUUID(); frameUrl.hash = new URLSearchParams({ nonce }).toString();
  const frame = hostDocument.createElement('iframe'); frame.title = title;
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;'; frame.src = frameUrl.href;
  let lifecycle = 'loading', latestState, latestPreferences, channel, connected = false, disposal, platformClosing, resolveReady, rejectReady, clipboard;
  const stateListeners = new Set(), uiListeners = new Set(), preferenceListeners = new Set(), disposalListeners = new Set(), actionControllers = new Set(), actionResults = new Map();
  const fontCacheStatus = new Map();
  const ready = new Promise((resolve,reject) => { resolveReady = resolve; rejectReady = reject; });
  const disposedError = () => new EditorError('EditorDisposed', 'Editor has been disposed');
  const report = error => hostWindow.console.error('Editor bridge failed', error);
  function updateState(value) {
    const next = stateValue(value);
    if (latestState && Object.keys(next).every(key => next[key] === latestState[key])) return;
    latestState = next;
    for (const listener of stateListeners) { try { listener(next); } catch (error) { report(error); } }
  }
  function updatePreferences(value) {
    const next = validatePreferences(value);
    if (latestPreferences && Object.keys(next).length === Object.keys(latestPreferences).length && Object.keys(next).every(key => next[key] === latestPreferences[key])) return;
    latestPreferences = next;
    for (const listener of preferenceListeners) { try { listener(next); } catch (error) { report(error); } }
  }
  function close(reason = disposedError()) {
    if (lifecycle === 'disposed') return;
    lifecycle = 'disposed'; clearTimeout(startupTimer);
    hostWindow.removeEventListener('message', bootstrap); hostWindow.removeEventListener('pagehide', pagehide);
    signal?.removeEventListener('abort', abort); rejectReady(reason);
    for (const controller of actionControllers) controller.abort(reason);
    actionControllers.clear(); actionResults.clear(); handlers.clear(); stateListeners.clear(); uiListeners.clear(); fontCacheStatus.clear();
    channel?.dispose(reason); frame.remove();
    clipboard?.dispose();
    preferenceListeners.clear(); latestPreferences = undefined;
    for (const listener of disposalListeners) { try { listener(); } catch (error) { report(error); } }
    disposalListeners.clear();
    platformClosing=platform.dispose();
    void platformClosing.catch(report);
  }
  function request(method, args = {}, requestOptions) {
    return lifecycle === 'ready' ? channel.request(method,args,requestOptions) : Promise.reject(disposedError());
  }
  function invoke(method, prepare) { try { return request(method, prepare()); } catch (error) { return Promise.reject(error); } }
  async function invokeAction(id) {
    if (lifecycle !== 'ready') throw disposedError();
    const descriptor = ui.actions.find(action => action.id === id), handler = handlers.get(id);
    if (!handler) throw new EditorError('UnknownAction', 'Unknown host action: ' + id);
    if (!descriptor.enabled || !descriptor.visible) throw new EditorError('ActionUnavailable', 'Host action is unavailable: ' + id);
    const controller = new AbortController(); actionControllers.add(controller);
    try { await handler({ editor: instance, signal: controller.signal }); }
    catch (error) {
      if (error instanceof EditorError) throw error;
      throw new EditorError(typeof error?.code === 'string' ? error.code : 'HostActionFailed', error?.message ?? String(error), { cause: error });
    }
    finally { actionControllers.delete(controller); }
    return null;
  }
  function bootstrap(event) {
    if (connected || event.source !== frame.contentWindow || event.origin !== frameUrl.origin || event.data?.type !== 'drawmotive:hello') return;
    if (event.data.protocolVersion !== PROTOCOL_VERSION) { close(new EditorError('ProtocolMismatch', 'Unsupported editor runtime protocol')); return; }
    connected = true;
    let ports;
    try {
      ports = new hostWindow.MessageChannel();
      channel = createRuntimeChannel({ port: ports.port1, instanceId, documentSessionId, requestTimeoutMs: deadlines.request, onError: error => lifecycle === 'loading' ? close(error) : report(error) });
      // Startup needs fonts and storage before the managed runtime can publish ready.
      for (const method of PLATFORM_METHODS) channel.onRequest(method, args => platform.request(method,args), { lane: 'platform' });
      channel.onRequest('host.action', (args, context) => {
        let result = actionResults.get(context.requestId);
        if (!result) {
          result = invokeAction(args.id); actionResults.set(context.requestId,result); void result.catch(() => {});
          if (actionResults.size > 128) actionResults.delete(actionResults.keys().next().value);
        }
        return result;
      }, { lane: 'platform' });
      channel.onEvent('ready', value => {
        if (lifecycle !== 'loading') return;
        try { updateState(value.state); lifecycle = 'ready'; clearTimeout(startupTimer); resolveReady(); } catch (error) { close(error); }
      });
      channel.onEvent('stateChanged', value => { try { updateState(value); } catch (error) { report(error); } });
      channel.onEvent('preferencesChanged', value => { try { updatePreferences(value); } catch (error) { report(error); } });
      channel.onEvent('fontCacheStatus', value => {
        if (typeof value?.path !== 'string' || !['hit','stored','unavailable','write-failed'].includes(value.cache)
            || value.detail !== undefined && typeof value.detail !== 'string') {
          report(new EditorError('InvalidRuntimeResponse','Invalid font cache status')); return;
        }
        fontCacheStatus.set(value.path,Object.freeze({ path: value.path,cache: value.cache,...(value.detail === undefined ? {} : { detail: value.detail }) }));
      });
      channel.onEvent('failed', value => { const error = fromErrorDescriptor(value); if (lifecycle === 'loading') close(error); else report(error); });
      frame.contentWindow.postMessage({ type: 'drawmotive:connect', protocolVersion: PROTOCOL_VERSION, nonce, instanceId, documentSessionId, options: { ui } }, frameUrl.origin, [ports.port2]);
      hostWindow.removeEventListener('message', bootstrap);
    } catch (error) { ports?.port2.close(); ports?.port1.close(); close(error); }
  }
  const abort = () => close(signal.reason ?? new DOMException('Initialization aborted', 'AbortError'));
  const pagehide = event => { if (!event.persisted) close(); };
  const startupTimer = setTimeout(() => close(new EditorError('StartupTimeout', 'Editor initialization timed out')), deadlines.startup);
  hostWindow.addEventListener('message', bootstrap); hostWindow.addEventListener('pagehide', pagehide); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  if (documentOptions) frame.addEventListener('load', () => {
    try {
      const document = frame.contentDocument; document.open(); frame.contentWindow.history.replaceState(null,'',frameUrl.href);
      document.write(documentOptions.html); document.close();
    } catch (error) { close(error); }
  }, { once: true });
  const subscribe = (listeners, listener, value) => {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (lifecycle !== 'ready') throw disposedError();
    listeners.add(listener); try { listener(value); } catch (error) { listeners.delete(listener); throw error; }
    return () => listeners.delete(listener);
  };
  const instance = Object.freeze({
    get lifecycle() { return lifecycle; }, get instanceId() { return instanceId; }, get documentSessionId() { return documentSessionId; }, get ui() { return ui; },
    replaceDocument(raw) { return invoke('replaceDocument', () => ({ raw: text(raw,'Document') })); },
    replacePngDocument(base64) { return invoke('replacePngDocument', () => ({ base64: text(base64,'PNG document') })); },
    replaceTextGraph(source) { return invoke('replaceTextGraph', () => ({ source: text(source,'TextGraph source') })); },
    clearDocument() { return request('clearDocument'); }, exportSnapshot(value) { return invoke('exportSnapshot', () => snapshotOptions(value)); },
    retryPersistence() { return request('retryPersistence'); },
    fitViewport(value) { return invoke('fitViewport', () => viewportOptions(value)); }, setEditingEnabled(enabled) { return invoke('setEditingEnabled', () => ({ enabled: boolean(enabled,'enabled') })); },
    undo() { return request('undo'); }, redo() { return request('redo'); },
    async getState() { const result = await request('getState'); updateState(result); return latestState; },
    onStateChanged(listener) { return subscribe(stateListeners,listener,latestState); },
    onUiChanged(listener) { return subscribe(uiListeners,listener,ui); },
    onPreferencesChanged(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      if (lifecycle !== 'ready') throw disposedError();
      preferenceListeners.add(listener);
      if (latestPreferences !== undefined) { try { listener(latestPreferences); } catch (error) { preferenceListeners.delete(listener); throw error; } }
      return () => preferenceListeners.delete(listener);
    },
    onDisposed(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      if (lifecycle === 'disposed') { listener(); return () => {}; }
      disposalListeners.add(listener); return () => disposalListeners.delete(listener);
    },
    onEvent(name, listener) { if (lifecycle !== 'ready') throw disposedError(); return channel.onEvent(name,listener); },
    getSelection() { return request('getSelection'); },
    setTool(tool) { return invoke('setTool', () => ({ tool: text(tool,'tool') })); },
    setProperty(token, change) { return request('setProperty',{ token, change }); },
    deleteSelection(token) { return request('deleteSelection',{ token }); },
    beginTextEditing(targetItemId) { return request('beginTextEditing',{ targetItemId }); },
    applyText(token,targetItemId,content) { return invoke('applyText', () => ({ token,targetItemId,content: text(content,'content') })); },
    copySelection(token) { return request('copySelection',{ token }); },
    pasteSelection(payload,position) { return request('pasteSelection',{ payload,position }); },
    copyToClipboard(token,options) { return clipboard.copy(token,options); },
    pasteFromClipboard(position,options) { return clipboard.paste(position,options); },
    async getPreferences() { const value = await request('getPreferences'); updatePreferences(value); return latestPreferences; },
    getFontCacheStatus() {
      if (lifecycle !== 'ready') throw disposedError();
      return Object.freeze([...fontCacheStatus.values()]);
    },
    setSketchyMode(enabled) { return invoke('setSketchyMode', () => ({ enabled: boolean(enabled,'enabled') })); },
    setPreferences(preferences) { return invoke('setPreferences', () => {
      keys(preferences,['darkTheme','showGrid','snapToGrid'],'preferences');
      return Object.fromEntries(Object.entries(preferences).map(([key,value]) => [key,boolean(value,'preferences.' + key)]));
    }); },
    zoom(direction) { return request('zoom',{ direction }); },
    invokeAction,
    setActionState(id,value) {
      try {
        if (lifecycle !== 'ready') throw disposedError();
        if (!handlers.has(id)) throw new TypeError('Unknown host action: ' + id);
        keys(value,['label','enabled','visible'],'action state');
        const update = {};
        if (value.label !== undefined) { if (!text(value.label,'Action label').trim()) throw new TypeError('Action label must not be empty'); update.label = value.label; }
        for (const key of ['enabled','visible']) if (value[key] !== undefined) update[key] = boolean(value[key],'Action ' + key);
        ui = Object.freeze({ ...ui, actions: Object.freeze(ui.actions.map(action => action.id === id ? Object.freeze({ ...action,...update }) : action)) });
        for (const listener of uiListeners) { try { listener(ui); } catch (error) { report(error); } }
        return Promise.resolve();
      } catch (error) { return Promise.reject(error); }
    },
    dispose() {
      if (disposal) return disposal;
      if (lifecycle === 'disposed') return Promise.resolve();
      // Establish ownership before abort dispatch invokes arbitrary host listeners.
      let complete, fail;
      disposal = new Promise((resolve,reject) => { complete = resolve; fail = reject; });
      lifecycle = 'disposing';
      for (const controller of actionControllers) controller.abort(disposedError());
      const cleanup = channel.request('dispose',{}, { timeoutMs: deadlines.dispose });
      void (async () => {
        let timer;
        try {
          await Promise.race([
            cleanup.then(() => platform.dispose()),
            new Promise((_,reject) => { timer = setTimeout(() => reject(new EditorError('DisposeTimeout','Editor cleanup exceeded its deadline.')),deadlines.dispose); }),
          ]);
        } catch (error) { throw new EditorError('DisposeCleanupUnconfirmed','Editor removed; runtime or platform cleanup was not confirmed',{ cause: error }); }
        finally { clearTimeout(timer); close(); }
      })().then(complete,fail);
      return disposal;
    },
  });
  const clipboardOptions = {};
  try { clipboardOptions.clipboard = hostWindow.navigator.clipboard; clipboardOptions.ClipboardItem = hostWindow.ClipboardItem; clipboardOptions.Blob = hostWindow.Blob; }
  catch { /* The internal clipboard remains usable when the host denies system access. */ }
  clipboard = createEditorClipboard(instance, clipboardOptions);
  if (lifecycle === 'disposed') clipboard.dispose();
  if (lifecycle !== 'disposed') container.append(frame);
  try { await ready; signal?.throwIfAborted(); signal?.removeEventListener('abort',abort); return instance; }
  catch (error) {
    close(error);
    // A failed startup can already own a persistent writer. Its rejection is
    // also the handoff boundary for hosts that immediately create a successor.
    let timer;
    try {
      await Promise.race([platformClosing,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Platform cleanup deadline exceeded.')),deadlines.dispose);})]);
    } catch {
      throw new EditorError('DisposeCleanupUnconfirmed','Editor startup failed; platform cleanup was not confirmed.',{cause:error});
    } finally {clearTimeout(timer);}
    throw error;
  }
}
