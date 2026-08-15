import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const packageRoot = path.resolve(import.meta.dirname, '..');
const textGraphRoot = path.resolve(packageRoot, '..', 'textgraph');

test('Editor uses TextGraph as a normal npm dependency and ships only editor runtime assets', async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, 'generated', 'wasm-manifest.json'), 'utf8'),
  );
  const textGraphManifest = JSON.parse(
    await readFile(path.join(textGraphRoot, 'generated', 'wasm-manifest.json'), 'utf8'),
  );

  assert.match(packageJson.dependencies['@drawmotive/textgraph'], /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.packageName, '@drawmotive/editor');
  assert.equal(manifest.privateSource.project, 'DrawMotive.Editor.Bridge');
  assert.equal(manifest.entryAssembly, 'wasm/DrawMotive.Editor.Bridge.wasm');
  assert.equal(manifest.runtimeWasm, 'wasm/dotnet.native.wasm');
  assert.doesNotMatch(JSON.stringify(manifest), /Graphics\.Core|TextGraph/);

  const textGraphHashes = new Set(textGraphManifest.assets.map((asset) => asset.sha256));
  const editorProductAssets = manifest.assets.filter(
    (asset) => !asset.path.match(/wasm\/(?:dotnet|System\.|netstandard)/),
  );
  assert.ok(editorProductAssets.length > 0);
  assert.ok(editorProductAssets.every((asset) => !textGraphHashes.has(asset.sha256)));
});

test('Editor manifest hashes every generated asset and excludes debug files', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, 'generated', 'wasm-manifest.json'), 'utf8'),
  );
  const actual = (await readdir(path.join(packageRoot, 'generated', 'wasm')))
    .map((name) => `wasm/${name}`)
    .sort();
  assert.deepEqual(actual, manifest.assets.map((asset) => asset.path).sort());

  for (const asset of manifest.assets) {
    assert.doesNotMatch(asset.path, /\.pdb$|\.map$|\.symbols$|\.br$|\.gz$|\.cs$/);
    const content = await readFile(path.join(packageRoot, 'generated', asset.path));
    assert.equal(content.byteLength, asset.bytes);
    assert.equal(createHash('sha256').update(content).digest('hex'), asset.sha256);
  }
});

test('Editor runtime composition initializes TextGraph before the editor bridge', async () => {
  const { initializeEditorRuntime } = await import('../src/runtime/browser.js');
  const calls = [];
  const textgraph = { marker: 'textgraph' };
  const result = await initializeEditorRuntime({
    initializeTextGraph: async () => { calls.push('textgraph'); return textgraph; },
    loadEditorRuntime: async () => { calls.push('editor'); return { marker: 'editor' }; },
  });

  assert.deepEqual(calls, ['textgraph', 'editor']);
  assert.equal(result.textgraph, textgraph);
  assert.equal(result.editor.marker, 'editor');
});
