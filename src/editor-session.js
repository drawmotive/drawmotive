import { EditorError, fromErrorDescriptor, immutableSnapshot } from './errors.js';
import { normalizeUiOptions } from './react/ui-options-runtime.js';
import { createPlatformServices } from './platform/services.js';
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


/** One page owns one canvas. A document switch awaits full native/platform cleanup. */
export async function createEditorSession(options = {}, privateOptions) {
  keys(options, ['container','assetBaseUrl','ui','persistence','workerFactory','workerUrls','signal','title','startupTimeoutMs','disposeTimeoutMs'], 'editor');
  const normalized = normalizeUiOptions(options.ui);
  let ui = normalized.ui;
  const handlers = normalized.handlers;
  const { container, signal } = options;
  const hostDocument = container?.ownerDocument, hostWindow = hostDocument?.defaultView;
  if (!hostWindow || !(container instanceof hostWindow.HTMLElement)) throw new TypeError('container must be an HTML element in a browser document');
  const deadlines = Object.fromEntries(['startup','dispose'].map(name => [name, positive(options[name + 'TimeoutMs'] ?? (name === 'dispose' ? 5000 : 120000), name + 'TimeoutMs')]));
  const title = options.title === undefined ? 'DrawMotive diagram editor' : text(options.title, 'title');
  if (options.workerFactory !== undefined && typeof options.workerFactory !== 'function') throw new TypeError('workerFactory must be a function');
  if (options.workerUrls !== undefined) keys(options.workerUrls, ['document','resource'], 'workerUrls');
  const assetBase = new URL(options.assetBaseUrl ?? new URL('../generated/editor/', import.meta.url), hostDocument.baseURI);
  if (!['https:','http:'].includes(assetBase.protocol) || assetBase.username || assetBase.password) throw new TypeError('assetBaseUrl must be an HTTP(S) URL');
  if (!assetBase.pathname.endsWith('/')) assetBase.pathname += '/'; assetBase.search = ''; assetBase.hash = '';
  signal?.throwIfAborted();
  const ownerKey = Symbol.for('drawmotive.canvasOwner');
  if (hostWindow[ownerKey]) throw new EditorError('EditorAlreadyMounted','Only one editor can be mounted per page. Dispose the current editor first.');
  const platform = createPlatformServices({ persistence: options.persistence, workerFactory: options.workerFactory, workerUrls: options.workerUrls,
    preferenceStore: createPreferenceStore({ storage: {
      getItem: key => hostWindow.localStorage.getItem(key),
      setItem: (key,value) => hostWindow.localStorage.setItem(key,value),
    } }),
  });
  const owner = {}; hostWindow[ownerKey] = owner;
  const previousPosition = container.style.position;
  const positioned = ['', 'static'].includes(hostWindow.getComputedStyle(container).position);
  if (positioned) container.style.position = 'relative';
  const canvasRoot = hostDocument.createElement('div');
  canvasRoot.className = 'dm-canvas-root'; canvasRoot.setAttribute('aria-label',title);
  canvasRoot.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  container.append(canvasRoot);
  let lifecycle = 'loading', latestState, latestPreferences, native, disposal, clipboard, queue = Promise.resolve();
  const stateListeners = new Set(), uiListeners = new Set(), preferenceListeners = new Set(), disposalListeners = new Set(), actionControllers = new Set(), eventListeners = new Map();
  const fontCacheStatus = new Map();
  const startup = new AbortController();
  const abort = () => startup.abort(signal.reason ?? new DOMException('Initialization aborted','AbortError'));
  signal?.addEventListener('abort',abort,{ once:true });
  if (signal?.aborted) abort();
  const disposedError = () => new EditorError('EditorDisposed', 'Editor has been disposed');
  const report = error => hostWindow.console.error('Editor failed', error);
  function emit(name,value) {
    if (lifecycle === 'disposed' || lifecycle === 'disposing') return;
    if (name === 'ready') updateState(value.state);
    else if (name === 'stateChanged') updateState(value);
    else if (name === 'preferencesChanged') updatePreferences(value);
    else if (name === 'fontCacheStatus') fontCacheStatus.set(value.path,immutableSnapshot(value));
    else if (name === 'failed') { const error = fromErrorDescriptor(value); if (lifecycle === 'loading') startup.abort(error); else report(error); }
    for (const listener of eventListeners.get(name) ?? []) { try { listener(immutableSnapshot(value)); } catch(error) { report(error); } }
  }
  function releaseOwnership() {
    if (hostWindow[ownerKey] === owner) delete hostWindow[ownerKey];
    if (positioned && container.style.position === 'relative') container.style.position = previousPosition;
  }
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
  function close() {
    lifecycle = 'disposed';
    hostWindow.removeEventListener('pagehide',pagehide);
    signal?.removeEventListener('abort',abort);
    for (const controller of actionControllers) controller.abort(disposedError());
    actionControllers.clear(); handlers.clear(); stateListeners.clear(); uiListeners.clear(); fontCacheStatus.clear(); eventListeners.clear();
    clipboard?.dispose(); preferenceListeners.clear(); latestPreferences = undefined;
    for (const listener of disposalListeners) { try { listener(); } catch(error) { report(error); } }
    disposalListeners.clear();
  }
  function request(method,args = {}) {
    if (lifecycle !== 'ready') return Promise.reject(disposedError());
    const copy = immutableSnapshot(args);
    const result = queue.then(() => native.request(method,copy)).then(immutableSnapshot).catch(error => {
      if (error instanceof EditorError) throw error;
      throw new EditorError(error?.code ?? 'RuntimeError',error?.message ?? String(error),{cause:error});
    });
    queue = result.catch(() => {});
    return result;
  }
  function invoke(method,prepare) { try { return request(method,prepare()); } catch(error) { return Promise.reject(error); } }
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
  const pagehide = event => { if (!event.persisted) void instance.dispose().catch(report); };
  hostWindow.addEventListener('pagehide',pagehide);
  const subscribe = (listeners, listener, value) => {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (lifecycle !== 'ready') throw disposedError();
    listeners.add(listener); try { listener(value); } catch (error) { listeners.delete(listener); throw error; }
    return () => listeners.delete(listener);
  };
  const instance = Object.freeze({
    get lifecycle() { return lifecycle; }, get ui() { return ui; },
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
    onEvent(name, listener) { if (lifecycle !== 'ready') throw disposedError(); if (typeof listener !== 'function') throw new TypeError('Listener must be a function'); let listeners = eventListeners.get(name); if (!listeners) eventListeners.set(name,listeners = new Set()); listeners.add(listener); return () => listeners.delete(listener); },
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
      let complete, fail;
      disposal = new Promise((resolve,reject) => { complete = resolve; fail = reject; });
      lifecycle = 'disposing';
      for (const controller of actionControllers) controller.abort(disposedError());
      // A successor cannot share a runtime whose previous scope or writer may still be alive.
      void bounded(async () => { await queue; await native.dispose(); await platform.dispose(); },deadlines.dispose).then(() => {
        canvasRoot.remove(); releaseOwnership(); close(); complete();
      },error => { close(); fail(new EditorError('DisposeCleanupUnconfirmed','Editor cleanup was not confirmed.',{cause:error})); });
      return disposal;
    },
  });
  const clipboardOptions = {};
  try { clipboardOptions.clipboard = hostWindow.navigator.clipboard; clipboardOptions.ClipboardItem = hostWindow.ClipboardItem; clipboardOptions.Blob = hostWindow.Blob; }
  catch { /* The internal clipboard remains usable when the host denies system access. */ }
  clipboard = createEditorClipboard(instance, clipboardOptions);
  const startupTimer = setTimeout(() => startup.abort(new EditorError('StartupTimeout','Editor initialization timed out.')),deadlines.startup);
  let starting;
  try {
    starting = (async () => {
    const load = privateOptions?.runtimeLoader ?? (url => import(/* @vite-ignore */ url));
    const runtime = await load(new URL('js/editor-canvas.js',assetBase).href);
    startup.signal.throwIfAborted();
    native = await runtime.mountCanvas({container:canvasRoot,assetBaseUrl:assetBase.href,
      options:{ui,...(privateOptions?.replication ? {initialEditingEnabled:false} : {})},
      drawingId:options.persistence?.documentId ?? hostWindow.crypto.randomUUID(),
      platform:(method,args) => platform.request(method,args),emit,signal:startup.signal});
    startup.signal.throwIfAborted();
    })();
    await abortable(starting,startup.signal);
    if (!latestState) throw new EditorError('InvalidRuntimeResponse','The canvas did not publish its initial state.');
    lifecycle = 'ready';
    clearTimeout(startupTimer); signal?.removeEventListener('abort',abort);
    return privateOptions?.replication ? Object.freeze({ editor: instance, replication: Object.freeze({
    establish: () => request('replica.establish'),
    read: () => request('replica.read'),
    apply: transactions => request('replica.apply', { transactions }),
    acknowledge: ids => request('replica.ack', { ids }),
    onChanged(listener) {
      let revision = latestState.revision, health = latestState.health;
      // Private reads acquire the document boundary and publish busy state.
      // Only durable document changes wake delivery, avoiding a read/wakeup loop.
      return instance.onStateChanged(state => {
        const changed = state.revision !== revision || state.health !== health;
        revision = state.revision; health = state.health;
        if (changed) listener();
      });
    },
  }) }) : instance; }
  catch (error) {
    clearTimeout(startupTimer); startup.abort(error);
    try { await bounded(async () => { await starting?.catch(failure => { if (failure?.code === 'DisposeCleanupUnconfirmed') throw failure; }); await native?.dispose(); await platform.dispose(); },deadlines.dispose); canvasRoot.remove(); releaseOwnership(); }
    catch (cleanup) { close(); throw new EditorError('DisposeCleanupUnconfirmed','Editor startup failed; cleanup was not confirmed.',{cause:cleanup}); }
    close(); throw error;
  }
}

async function bounded(operation,timeoutMs) {
  let timer;
  try { return await Promise.race([operation(),new Promise((_,reject) => {timer = setTimeout(() => reject(new EditorError('DisposeTimeout','Editor cleanup exceeded its deadline.')),timeoutMs);})]); }
  finally {clearTimeout(timer);}
}

function abortable(operation,signal) {
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
    operation.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
