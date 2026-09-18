import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeEditor } from '../src/index.js';

function host(t) {
  const dom = new JSDOM('<div id="editor"></div>', { url: 'https://app.example/demo/' });
  t.after(() => dom.window.close());
  const container = dom.window.document.querySelector('#editor');
  const options = { container, assetBaseUrl: '/runtime/', timeoutMs: 1000 };
  const frame = () => container.querySelector('iframe');
  const send = (data, overrides = {}) => {
    const channel = new URLSearchParams(new URL(frame().src).hash.slice(1)).get('channel');
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: frame().contentWindow, origin: 'https://app.example', data: { channel, ...data }, ...overrides,
    }));
  };
  const ready = () => {
    frame().contentWindow.postMessage = message => {
      if (message.method === 'dispose') send({ type: 'response', id: message.id });
    };
    send({ type: 'ready', protocolVersion: 1 });
  };
  return { dom, container, options, frame, send, ready };
}

test('mount waits for authenticated scene readiness and imports initial source', async t => {
  const h = host(t);
  const result = initializeEditor({ ...h.options, source: 'A -> B' });
  assert.equal(h.frame().title, 'DrawMotive diagram editor');
  assert.equal(new URL(h.frame().src).pathname, '/runtime/embed.html');
  const messages = [];
  h.ready();
  h.frame().contentWindow.postMessage = (message, origin) => {
    messages.push({ message, origin });
    h.send({ type: 'response', id: message.id });
  };
  const editor = await result;
  assert.equal(messages[0].message.method, 'importTextGraph');
  assert.equal(messages[0].message.payload, 'A -> B');
  assert.equal(messages[0].origin, 'https://app.example');
  assert.equal(editor.state, 'ready');
  await editor.dispose();
  assert.equal(h.frame(), null);
});

test('messages from other origins, frames or channels cannot resolve export', async t => {
  const h = host(t);
  const result = initializeEditor(h.options);
  h.ready();
  const editor = await result;
  let request;
  h.frame().contentWindow.postMessage = message => {
    if (message.method === 'dispose') h.send({ type: 'response', id: message.id });
    else request = message;
  };
  let resolved = false;
  const exported = editor.exportDocument().then(value => { resolved = true; return value; });
  const response = { type: 'response', id: request.id, result: { raw: 'document', png: 'image', width: 10, height: 20 } };
  h.send(response, { origin: 'https://other.example' });
  h.send(response, { source: h.dom.window });
  h.send({ ...response, channel: 'different-channel' });
  await Promise.resolve();
  assert.equal(resolved, false);
  h.send(response);
  assert.deepEqual(await exported, response.result);
  await editor.dispose();
});

test('abort during startup or initial import removes the frame', async t => {
  for (const initialImport of [false, true]) {
    const h = host(t);
    const controller = new AbortController();
    const result = initializeEditor({ ...h.options, signal: controller.signal, ...(initialImport ? { source: 'A' } : {}) });
    if (initialImport) { h.ready(); await Promise.resolve(); }
    controller.abort();
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(h.frame(), null);
  }
});

test('initialization rejects incompatible runtimes, failed imports, and missing assets', async t => {
  const h = host(t);
  const incompatible = initializeEditor(h.options);
  h.send({ type: 'ready', protocolVersion: 2 });
  await assert.rejects(incompatible, /Unsupported editor runtime protocol/);
  const failed = initializeEditor({ ...h.options, document: 'bad-data' });
  h.ready();
  h.frame().contentWindow.postMessage = message => h.send({ type: 'response', id: message.id, error: 'Invalid document' });
  await assert.rejects(failed, /Invalid document/);
  await assert.rejects(initializeEditor({ ...h.options, timeoutMs: 5 }), /initialization timed out/);
  assert.equal(h.frame(), null);
});

test('dispose rejects pending work and remains idempotent', async t => {
  const h = host(t);
  const result = initializeEditor(h.options);
  h.ready();
  const editor = await result;
  const exportResult = editor.exportDocument();
  const rejected = assert.rejects(exportResult, /disposed/);
  await editor.dispose();
  await rejected;
  await editor.dispose();
  await assert.rejects(editor.importTextGraph('A'), /disposed/);
  assert.equal(editor.state, 'disposed');
});

test('input validation happens before mounting a runtime', async t => {
  const h = host(t);
  await assert.rejects(initializeEditor({}), /container/);
  await assert.rejects(initializeEditor({ ...h.options, source: 'A', document: '' }), /not both/);
  await assert.rejects(initializeEditor({ ...h.options, assetBaseUrl: 'javascript:alert(1)' }), /HTTP/);
  await assert.rejects(initializeEditor({ ...h.options, timeoutMs: 0 }), /positive/);
  assert.equal(h.frame(), null);
});
