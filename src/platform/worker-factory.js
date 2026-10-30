/** Websites use static assets; VS Code fetches the same self-contained file into a Blob. */
export function createWorkerFactory({ mode = 'static', Worker = globalThis.Worker, fetch = globalThis.fetch, URL = globalThis.URL } = {}) {
  if (!['static', 'blob'].includes(mode)) throw new TypeError('Unknown Worker loading mode.');
  return async (url, options = {}) => {
    let blobUrl, worker;
    try {
      if (mode === 'blob') {
        const response = await fetch(url);
        if (!response.ok) throw Object.assign(new Error('Worker asset unavailable: HTTP ' + response.status), { code: 'WorkerUnavailable' });
        blobUrl = URL.createObjectURL(await response.blob());
      }
      worker = new Worker(blobUrl ?? url, options);
    } catch (error) { if (blobUrl) URL.revokeObjectURL(blobUrl); throw error; }
    let disposed = false;
    return Object.freeze({ worker, dispose() {
      if (disposed) return;
      disposed = true;
      try { worker.terminate(); } finally { if (blobUrl) URL.revokeObjectURL(blobUrl); }
    } });
  };
}
