// One WASM runtime belongs to the page; each opened document owns a fresh native root.
let activeCanvas, runtimeStartup, runtimeAssetBaseUrl, runtimeAssetVersion, resolveRuntimeReady, rejectRuntimeReady;
const browserFontLoads = new Map();
const error = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });
const json = value => JSON.stringify(value, (_key, item) => {
  // System.Text.Json represents byte[] as base64. Platform and Worker calls stay binary.
  if (!(item instanceof Uint8Array)) return item;
  let binary = '';
  for (let offset = 0; offset < item.length; offset += 16384) binary += String.fromCharCode(...item.subarray(offset, offset + 16384));
  return btoa(binary);
});
function current() {
  if (!activeCanvas || activeCanvas.closed) throw error('EditorDisposed', 'The canvas is unavailable.');
  return activeCanvas;
}
function emit(name, payload) { const owner = current(); if (!owner.closing) owner.emit(name, payload); }
function platform(method, args = {}) {
  // Storage/resource replies remain independent of an awaiting document operation.
  try { return Promise.resolve(current().platform(method, args)); }
  catch (failure) { return Promise.reject(failure); }
}
async function loadFontResource(path, url, sha256) {
  const result = await platform('fonts.load', { path, url, sha256 });
  emit('fontCacheStatus', { path, cache: result.cache, ...(result.detail === undefined ? {} : { detail: result.detail }) });
  return result;
}
async function prepareBrowserFont(path, sha256, bytes, pack) {
  const family = pack?.family ?? path.split('/').pop().replace(/[.]ttf$/i, '');
  // Disjoint packs share a family alias, while verified resource identity owns installation.
  const resourceKey = JSON.stringify([path, sha256]);
  let loading = browserFontLoads.get(resourceKey);
  if (!loading) {
    loading = (async () => {
      try {
        const weight = pack?.weight ?? (['NotoSans-Regular', 'NotoSansSC-Regular', 'NotoSansJP-Regular'].includes(family) ? '100 900' : '400');
        const descriptors = { weight, style: 'normal', display: 'swap' };
        if (pack?.coverage) descriptors.unicodeRange = pack.coverage.map(([first, last]) => 'U+' + first.toString(16).toUpperCase() + (first === last ? '' : '-' + last.toString(16).toUpperCase())).join(', ');
        const face = new FontFace(family, bytes, descriptors);
        await face.load();
        // FontFaces share the WASM font-cache lifetime and survive document close/reopen.
        document.fonts.add(face);
      } catch (failure) { throw error('ResourceUnavailable', 'Required browser font could not load: ' + family, failure); }
    })();
    browserFontLoads.set(resourceKey, loading);
  }
  try { await loading; }
  catch (failure) { if (browserFontLoads.get(resourceKey) === loading) browserFontLoads.delete(resourceKey); throw failure; }
}
globalThis.drawmotiveCanvas = Object.freeze({
  getDrawingId: () => current().drawingId,
  getAssetBaseUrl: () => runtimeAssetBaseUrl,
  getPageAddress: () => globalThis.location?.href ?? null,
  getLanguage: () => document.documentElement?.lang || globalThis.navigator?.language || 'en',
  // The public component initializer runs only after the framework enables dynamic roots.
  runtimeReady: () => resolveRuntimeReady?.(),
  getOptions: () => {
    const options = current().options;
    return JSON.stringify({ textEditing: options.textEditing ?? 'inline', initialEditingEnabled: options.initialEditingEnabled ?? true, licenseKey: options.licenseKey });
  },
  failed: failure => {
    const owner = current();
    const startupFailure = typeof failure === 'string' ? error('StartupFailed', failure) : failure;
    owner.resolveStartupSettled();
    rejectRuntimeReady?.(startupFailure);
    owner.fail(startupFailure);
  },
  disposed: failure => {
    const owner = current();
    if (failure) owner.rejectDisposed(error('DisposalFailed', failure));
    else owner.resolveDisposed();
  },
  ready: (reference, stateJson) => {
    const owner = current();
    owner.reference = reference;
    // JS relays restoration only; C# owns parsing, signature, origin and time decisions.
    const refresh = () => {
      if (!owner.closing && !owner.closed && owner.reference && document.visibilityState !== 'hidden')
        owner.reference.invokeMethodAsync('RefreshLicense').catch(() => {});
    };
    globalThis.addEventListener('pageshow', refresh);
    globalThis.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    owner.detachRestoration = () => {
      globalThis.removeEventListener('pageshow', refresh);
      globalThis.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
    owner.resolveStartupSettled();
    if (!owner.closing) { const state = JSON.parse(stateJson); owner.emit('ready', { state }); owner.resolveReady(); }
  },
  stateChanged: stateJson => emit('stateChanged', JSON.parse(stateJson)),
  selectionChanged: selectionJson => emit('selectionChanged', JSON.parse(selectionJson)),
  preferencesChanged: preferencesJson => emit('preferencesChanged', JSON.parse(preferencesJson)),
  textEditingRequested: intentionJson => emit('textEditingRequested', JSON.parse(intentionJson)),
  setDarkTheme: dark => { const owner = current(); owner.container.dataset.theme = dark ? 'dark' : 'light'; },
  // Retain native typography before web chrome mounts; later changes bubble only
  // from this document's canvas, without modifying its caller-owned container.
  setFontFamily: family => {
    const owner = current(), property = '--drawmotive-font-family';
    if (owner.container.style.getPropertyValue(property) === family) return;
    owner.container.style.setProperty(property, family);
    owner.container.dispatchEvent(new CustomEvent('drawmotive:font-family-change', { bubbles: true, detail: family }));
  },
  platform,
  openDocument: () => platform('storage.open').then(() => null),
  readDocumentCheckpoint: () => platform('storage.read'),
  readDocumentJournal: () => platform('storage.journal'),
  commitDocument: batch => platform('storage.commit', { batch }),
  loadFont: async (path, url, sha256, pack) => {
    const result = await loadFontResource(path, url, sha256);
    // All renderers, including color emoji, consume the same verified font bytes.
    await prepareBrowserFont(path, sha256, result.bytes, pack);
    return result.bytes;
  },
  getPreferences: async () => JSON.stringify(await platform('preferences.get')),
  updatePreferences: preferencesJson => platform('preferences.update', JSON.parse(preferencesJson)).then(() => null),
});
function loadAsset(tag, attributes) {
  return new Promise((resolve, reject) => {
    const node = document.createElement(tag);
    Object.assign(node, attributes);
    if (tag === 'script') node.setAttribute('autostart', 'false');
    node.onload = resolve;
    node.onerror = () => { node.remove(); reject(error('ResourceUnavailable', 'Could not load canvas asset: ' + (node.src ?? node.href))); };
    document.head.appendChild(node);
  });
}
function startRuntime(assetBaseUrl, assetPaths = {}) {
  const assetVersion = JSON.stringify([assetBaseUrl, assetPaths]);
  if (runtimeStartup) {
    if (runtimeAssetVersion !== assetVersion) throw error('InvalidArgument', 'A page must use one editor asset version.');
    return runtimeStartup;
  }
  runtimeAssetBaseUrl = assetBaseUrl;
  runtimeAssetVersion = assetVersion;
  const assetUrl = logical => new URL(assetPaths[logical] ?? logical, assetBaseUrl).href;
  const rendererReady = new Promise((resolve, reject) => { resolveRuntimeReady = resolve; rejectRuntimeReady = reject; });
  rendererReady.catch(() => {});
  runtimeStartup = (async () => {
    await Promise.all([
      loadAsset('link', { rel: 'stylesheet', href: assetUrl('css/editor-canvas.css') }),
      loadAsset('link', { rel: 'stylesheet', href: assetUrl('Editor.Client.styles.css') }),
      loadAsset('script', { src: assetUrl('_framework/blazor.webassembly.js') }),
    ]);
    await Blazor.start({ loadBootResource: (type, _name, uri, integrity) => {
      const url = assetUrl(uri);
      if (type === 'dotnetjs') return url;
      // .NET 10 fingerprints each WASM filename. Keep that URL as its cache
      // identity and retain SRI even when reusing a previously cached response.
      const immutableWasm = /[.][a-z0-9]{10}[.]wasm$/.test(new URL(url).pathname) && !!integrity;
      return fetch(url, { cache: immutableWasm ? 'force-cache' : 'no-cache', integrity });
    } });
    // Blazor.start starts the async managed entry point without awaiting renderer creation.
    await rendererReady;
  })();
  return runtimeStartup;
}
function readResponse(owner, serialized) {
  const response = JSON.parse(serialized);
  if (response.state && !owner.closing) owner.emit('stateChanged', response.state);
  if (response.error) throw error(response.error.code, response.error.message);
  return response.result;
}
async function execute(owner, method, args) {
  return readResponse(owner, await owner.reference.invokeMethodAsync('ExecuteAsync', method, json(args ?? {})));
}
/** Mounts the page's only canvas. Cleanup finishes before another document can open. */
export async function mountCanvas({ container, assetBaseUrl, assetPaths, options, drawingId, platform: platformCallback, emit: emitCallback, signal }) {
  if (activeCanvas) throw error('EditorAlreadyMounted', 'Only one DrawMotive canvas can be mounted on a page.');
  if (signal?.aborted) throw error('Aborted', 'Canvas startup was aborted.');
  const owner = { container, options, drawingId, platform: platformCallback, emit: emitCallback, closing: false, closed: false };
  activeCanvas = owner;
  container.classList.add('drawmotive-canvas-host');
  let root, failure, cleanup;
  const ready = new Promise((resolve, reject) => { owner.resolveReady = resolve; owner.fail = reject; });
  // Observe early managed failures while script startup/root creation is still pending.
  ready.catch(() => {});
  // Aborting public readiness does not cancel Skia's managed module imports.
  // Managed ready/failure signals prove those imports settled before DOM removal.
  const startupSettled = new Promise(resolve => { owner.resolveStartupSettled = resolve; });
  const disposed = new Promise((resolve, reject) => { owner.resolveDisposed = resolve; owner.rejectDisposed = reject; });
  disposed.catch(() => {});
  const abort = () => { failure = error('Aborted', 'Canvas startup was aborted.'); owner.closing = true; owner.fail(failure); };
  signal?.addEventListener('abort', abort, { once: true });
  const disposeRoot = async () => {
    // Delayed ready may install listeners while an aborted mount waits for native startup.
    if (root) await startupSettled;
    owner.detachRestoration?.();
    if (root) {
      await root.dispose();
      // RemoveRootComponent returns before asynchronous component/scope disposal.
      await disposed;
    }
    owner.closed = true;
    owner.reference = null;
    container.classList.remove('drawmotive-canvas-host');
    delete container.dataset.theme;
    container.style.removeProperty('--drawmotive-font-family');
    if (activeCanvas === owner) activeCanvas = undefined;
  };
  try {
    await startRuntime(new URL(assetBaseUrl, document.baseURI).href, assetPaths);
    if (failure) throw failure;
    root = await Blazor.rootComponents.add(container, 'drawmotive-canvas', {});
    await ready;
    if (failure) throw failure;
  } catch (startupFailure) {
    owner.closing = true;
    await disposeRoot();
    throw startupFailure;
  } finally { signal?.removeEventListener('abort', abort); }
  return {
    // The private site loader owns this preparation capability and drains it
    // before native disposal. The public SDK only uses request and dispose.
    compileTextGraph: async source => {
      if (owner.closing || owner.closed) throw error('EditorDisposed', 'The canvas is unavailable.');
      return readResponse(owner, await owner.reference.invokeMethodAsync('CompileSiteTextGraphAsync', source));
    },
    request: async (method, args) => {
      if (owner.closing || owner.closed) throw error('EditorDisposed', 'The canvas is unavailable.');
      return execute(owner, method, args);
    },
    dispose: () => {
      if (cleanup) return cleanup;
      // The SDK drains its document operations before requesting native disposal.
      cleanup = (async () => {
        if (owner.closed) return;
        await execute(owner, 'dispose', {});
        owner.closing = true;
        await disposeRoot();
      })().catch(failure => { cleanup = undefined; throw failure; });
      return cleanup;
    },
  };
}
