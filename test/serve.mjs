import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
/** Serve the unchanged runnable package demo; port zero supports isolated captures. */
export async function serveExample(port = 4186) {
  const server = createServer(async (request, response) => {
    try {
      let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
      relative = relative.replace(/^examples[/]browser[/]runtime[/]/, 'generated/editor/');
      let file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) && file !== root) throw new Error('Invalid path');
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await serveExample();
