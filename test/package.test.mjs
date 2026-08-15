import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const packageRoot = path.resolve(import.meta.dirname, '..');

test('editor scaffold uses the reserved public package identity but cannot publish yet', async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, '@drawmotive/editor');
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.engines.node, '>=22');
  assert.equal(packageJson.scripts.test, 'node --test test/*.test.mjs');
  assert.equal(packageJson.scripts.build, 'node --check src/index.js && tsc -p tsconfig.json');
  assert.equal(packageJson.types, './src/index.d.ts');
  assert.equal(packageJson.exports['.'].types, './src/index.d.ts');
  assert.equal(packageJson.scripts.prepack, 'npm test && npm run build');
  assert.deepEqual(packageJson.files, ['src', 'generated/wasm', 'generated/wasm-manifest.json']);
});

test('editor ESM entry composes TextGraph and editor runtime initialization', async () => {
  const editor = await import('../src/index.js');

  assert.equal(typeof editor.initializeEditor, 'function');
  const calls = [];
  const instance = await editor.initializeEditor({
    initializeTextGraph: async () => {
      calls.push('textgraph');
      return { dispose: async () => undefined };
    },
    loadRuntime: async () => {
      calls.push('editor');
      return { abiVersion: '1.0.0' };
    },
  });
  assert.deepEqual(calls, ['textgraph', 'editor']);
  assert.equal(instance.state, 'ready');
  assert.equal(editor.abiManifest.packageName, '@drawmotive/editor');
});

test('editor metadata and documentation contain no private source paths', async () => {
  const content = [
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    await readFile(path.join(packageRoot, 'README.md'), 'utf8'),
  ].join('\n');

  assert.doesNotMatch(content, /graphics\.core|editor\.client|C:\\src|\/Users\//);
});
