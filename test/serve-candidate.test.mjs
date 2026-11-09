import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serveExample } from './serve.mjs';

test('browser verification can select candidate native assets while retaining the current SDK sources', async t => {
  const assetRoot = await mkdtemp(path.join(tmpdir(), 'editor-browser-candidate-'));
  t.after(() => rm(assetRoot, { recursive: true, force: true }));
  await writeFile(path.join(assetRoot, 'candidate-marker.txt'), 'candidate-native-bytes');
  const server = await serveExample(0, { assetRoot });
  t.after(() => server.close());
  for (const prefix of ['generated/editor/', 'examples/browser/runtime/']) {
    const response = await fetch(server.url + prefix + 'candidate-marker.txt');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'candidate-native-bytes');
  }
  const source = await fetch(server.url + 'src/core.js');
  assert.equal(source.status, 200);
  assert.match(await source.text(), /createEditor/);
});
