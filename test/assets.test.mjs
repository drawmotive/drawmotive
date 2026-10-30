import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyAssets } from '../scripts/verify-assets.mjs';

test('asset verifier rejects tampering, extra files and symbolic links before copying', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'editor-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'generated/editor/js'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.1' }));
  const content = 'export async function mountCanvas() {}';
  const file = path.join(root, 'generated/editor/js/editor-canvas.js');
  const manifest = {
    schemaVersion: 1, runtimeVersion: 1, packageName: '@drawmotive/editor', packageVersion: '0.2.1',
    privateSource: { commit: 'a'.repeat(40) },
    assets: [{ path: 'editor/js/editor-canvas.js', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }],
  };
  await writeFile(path.join(root, 'generated/editor-manifest.json'), JSON.stringify(manifest));
  await writeFile(file, content);
  await verifyAssets(root);
  await writeFile(path.join(root, 'generated/editor-manifest.json'), JSON.stringify({ ...manifest, runtimeVersion: 99 }));
  await assert.rejects(verifyAssets(root), /manifest does not match/);
  await writeFile(path.join(root, 'generated/editor-manifest.json'), JSON.stringify(manifest));
  await writeFile(file, 'changed');
  await assert.rejects(verifyAssets(root), /integrity/);
  await writeFile(file, content);
  await writeFile(path.join(root, 'generated/editor/unlisted.js'), 'unexpected');
  await assert.rejects(verifyAssets(root), /complete asset tree/);
  await rm(path.join(root, 'generated/editor/unlisted.js'));
  // Windows directory junctions exercise the same authority boundary without
  // requiring Developer Mode or a file-symlink privilege in CI.
  await rm(path.join(root, 'generated/editor/js'), { recursive: true });
  const outside = path.join(root, 'outside');
  await mkdir(path.join(outside,'js'),{recursive:true});
  await writeFile(path.join(outside, 'js/editor-canvas.js'), content);
  await symlink(path.join(outside,'js'), path.join(root, 'generated/editor/js'), 'junction');
  await assert.rejects(verifyAssets(root), /symbolic links/);
});

test('public browser package has no private loader, auth or collaboration transport dependency', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@drawmotive/editor');
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.exports['./node'], undefined);
  assert.equal(pkg.exports['./worker'], undefined);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@mantine/core', '@mantine/hooks', 'dexie',
  ]);
  assert.equal(pkg.peerDependencies.react, '^19.0.0');
  assert.equal(pkg.peerDependencies['react-dom'], '^19.0.0');
  assert.equal(pkg.peerDependenciesMeta.react.optional, true);
  assert.ok(pkg.files.includes('dist'));
  assert.ok(pkg.files.includes('generated/editor'));
  assert.ok(pkg.files.includes('examples'));
});
