// One WASM runtime belongs to the page; each opened document owns a fresh native root.
let activeCanvas, runtimeStartup, runtimeAssetBaseUrl, resolveRuntimeReady, rejectRuntimeReady;
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
async function prepareBrowserFont(path, bytes) {
  let family = path.split('/').pop().replace(/[.](ttf|otf|woff2?)$/i, '');
  if (family === 'Noto-COLRv1') family = 'NotoColorEmoji';
  let loading = browserFontLoads.get(family);
  if (!loading) {
    loading = (async () => {
      try {
        const weight = ['NotoSans-Regular', 'NotoSansSC-Regular', 'NotoSansJP-Regular'].includes(family) ? '100 900' : '400';
        const face = new FontFace(family, bytes, { weight, style: 'normal', display: 'swap' });
        await face.load();
        // FontFaces share the WASM font-cache lifetime and survive document close/reopen.
        document.fonts.add(face);
      } catch (failure) { throw error('ResourceUnavailable', 'Required browser font could not load: ' + family, failure); }
    })();
    browserFontLoads.set(family, loading);
  }
  try { await loading; }
  catch (failure) { if (browserFontLoads.get(family) === loading) browserFontLoads.delete(family); throw failure; }
}
globalThis.drawmotiveCanvas = Object.freeze({
  getDrawingId: () => current().drawingId,
  getAssetBaseUrl: () => runtimeAssetBaseUrl,
  // The public component initializer runs only after the framework enables dynamic roots.
  runtimeReady: () => resolveRuntimeReady?.(),
  getOptions: () => {
    const options = current().options;
    return JSON.stringify({ ui: { textEditing: options.ui?.textEditing ?? 'inline' }, initialEditingEnabled: options.initialEditingEnabled ?? true });
  },
  failed: failure => {
    const owner = current();
    const startupFailure = typeof failure === 'string' ? error('StartupFailed', failure) : failure;
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
    if (!owner.closing) { const state = JSON.parse(stateJson); owner.emit('ready', { state }); owner.resolveReady(); }
  },
  stateChanged: stateJson => emit('stateChanged', JSON.parse(stateJson)),
  selectionChanged: selectionJson => emit('selectionChanged', JSON.parse(selectionJson)),
  preferencesChanged: preferencesJson => emit('preferencesChanged', JSON.parse(preferencesJson)),
  textEditingRequested: intentionJson => emit('textEditingRequested', JSON.parse(intentionJson)),
  setDarkTheme: dark => { const owner = current(); owner.container.dataset.theme = dark ? 'dark' : 'light'; },
  platform,
  openDocument: () => platform('storage.open').then(() => null),
  readDocumentCheckpoint: () => platform('storage.read'),
  commitDocument: batch => platform('storage.commit', { batch }),
  loadFont: async (path, url, sha256, browserFontSha256) => {
    const emoji = path === 'NotoColorEmoji.ttf' || path.endsWith('/NotoColorEmoji.ttf');
    if (emoji && (typeof browserFontSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(browserFontSha256)))
      throw error('ResourceUnavailable', 'The browser emoji font requires a verified COLRv1 manifest entry.');
    const result = await loadFontResource(path, url, sha256);
    if (emoji) {
      // Firefox needs COLRv1; Skia needs the bitmap font from the same verified release.
      const browserPath = path.slice(0, -'NotoColorEmoji.ttf'.length) + 'Noto-COLRv1.ttf';
      const browser = await loadFontResource(browserPath, new URL('Noto-COLRv1.ttf', url).href, browserFontSha256);
      await prepareBrowserFont(browserPath, browser.bytes);
    } else await prepareBrowserFont(path, result.bytes);
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
function startRuntime(assetBaseUrl) {
  if (runtimeStartup) {
    if (runtimeAssetBaseUrl !== assetBaseUrl) throw error('InvalidArgument', 'A page must use one editor asset version.');
    return runtimeStartup;
  }
  runtimeAssetBaseUrl = assetBaseUrl;
  const rendererReady = new Promise((resolve, reject) => { resolveRuntimeReady = resolve; rejectRuntimeReady = reject; });
  rendererReady.catch(() => {});
  runtimeStartup = (async () => {
    await Promise.all([
      loadAsset('link', { rel: 'stylesheet', href: new URL('css/editor-canvas.css', assetBaseUrl).href }),
      loadAsset('link', { rel: 'stylesheet', href: new URL('Editor.Client.styles.css', assetBaseUrl).href }),
      loadAsset('script', { src: new URL('_framework/blazor.webassembly.js', assetBaseUrl).href }),
    ]);
    await Blazor.start({ loadBootResource: (type, _name, uri, integrity) => {
      const url = new URL(uri, assetBaseUrl).href;
      return type === 'dotnetjs' ? url : fetch(url, { cache: 'no-cache', integrity });
    } });
    // Blazor.start starts the async managed entry point without awaiting renderer creation.
    await rendererReady;
  })();
  return runtimeStartup;
}
async function execute(owner, method, args) {
  const response = JSON.parse(await owner.reference.invokeMethodAsync('ExecuteEmbeddedAsync', method, json(args ?? {})));
  if (response.state && !owner.closing) owner.emit('stateChanged', response.state);
  if (response.error) throw error(response.error.code, response.error.message);
  return response.result;
}
/** Mounts the page's only canvas. Cleanup finishes before another document can open. */
export async function mountCanvas({ container, assetBaseUrl, options, drawingId, platform: platformCallback, emit: emitCallback, signal }) {
  if (activeCanvas) throw error('EditorAlreadyMounted', 'Only one DrawMotive canvas can be mounted on a page.');
  if (signal?.aborted) throw error('Aborted', 'Canvas startup was aborted.');
  const owner = { container, options, drawingId, platform: platformCallback, emit: emitCallback, closing: false, closed: false };
  activeCanvas = owner;
  container.classList.add('drawmotive-canvas-host');
  let root, failure, cleanup;
  const ready = new Promise((resolve, reject) => { owner.resolveReady = resolve; owner.fail = reject; });
  // Observe early managed failures while script startup/root creation is still pending.
  ready.catch(() => {});
  const disposed = new Promise((resolve, reject) => { owner.resolveDisposed = resolve; owner.rejectDisposed = reject; });
  disposed.catch(() => {});
  const abort = () => { failure = error('Aborted', 'Canvas startup was aborted.'); owner.closing = true; owner.fail(failure); };
  signal?.addEventListener('abort', abort, { once: true });
  const disposeRoot = async () => {
    if (root) {
      await root.dispose();
      // RemoveRootComponent returns before asynchronous component/scope disposal.
      await disposed;
    }
    owner.closed = true;
    owner.reference = null;
    container.classList.remove('drawmotive-canvas-host');
    delete container.dataset.theme;
    if (activeCanvas === owner) activeCanvas = undefined;
  };
  try {
    await startRuntime(new URL(assetBaseUrl, document.baseURI).href);
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
