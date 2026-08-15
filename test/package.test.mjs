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
  assert.equal(packageJson.scripts.build, 'node --check src/index.js');
  assert.equal(packageJson.scripts.prepack, 'npm test && npm run build');
  assert.deepEqual(packageJson.files, ['src', 'generated/wasm', 'generated/wasm-manifest.json']);
});

test('editor entry imports without exposing placeholder product behavior', async () => {
  const editor = await import('../src/index.js');

  assert.deepEqual(Object.keys(editor), []);
});

test('editor metadata and documentation contain no private source paths', async () => {
  const content = [
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    await readFile(path.join(packageRoot, 'README.md'), 'utf8'),
  ].join('\n');

  assert.doesNotMatch(content, /graphics\.core|editor\.client|C:\\src|\/Users\//);
});
