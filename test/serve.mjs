import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
/** Candidate verification selects native assets explicitly while keeping the SDK sources
 * and sealed release projection unchanged. Port zero supports isolated captures. */
export async function serveExample(port = 4186, { runtimeUrl, assetRoot } = {}) {
  const assets = assetRoot === undefined ? null : await realpath(path.resolve(assetRoot));
  const runtimeBase = runtimeUrl === undefined ? undefined : new URL(runtimeUrl);
  if (runtimeBase && (!['http:', 'https:'].includes(runtimeBase.protocol) || runtimeBase.username || runtimeBase.password))
    throw new TypeError('The test runtime must use an HTTP(S) URL.');
  if (runtimeBase && !runtimeBase.pathname.endsWith('/')) runtimeBase.pathname += '/';
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      let relative = decodeURIComponent(requestUrl.pathname).slice(1);
      // Local WASM DevServer has no cross-origin font CORS headers. A same-origin
      // asset path matches the package's copy-assets deployment and exercises the
      // exact runtime bytes without synthetic runtime documents or browser flags.
      if (runtimeBase && relative.startsWith('runtime/')) {
        if (relative.split('/').includes('..') || !['GET', 'HEAD'].includes(request.method)) throw new Error('Invalid runtime request');
        const upstreamUrl = new URL(relative.slice('runtime/'.length), runtimeBase); upstreamUrl.search = requestUrl.search;
        const upstream = await fetch(upstreamUrl, { method: request.method });
        response.statusCode = upstream.status;
        for (const header of ['content-type', 'cache-control', 'etag', 'last-modified'])
          if (upstream.headers.has(header)) response.setHeader(header, upstream.headers.get(header));
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      relative = relative.replace(/^examples[/]browser[/]runtime[/]/, 'generated/editor/');
      const base = assets && relative.startsWith('generated/editor/') ? assets : root;
      if (base === assets) relative = relative.slice('generated/editor/'.length);
      let file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep) && file !== base) throw new Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      response.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/',
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await serveExample(4186, { assetRoot: process.env.DRAWMOTIVE_EDITOR_TEST_ASSET_ROOT });
