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
  await mkdir(path.join(root, 'generated/editor'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.1' }));
  const content = '<!doctype html><title>Editor</title>';
  const file = path.join(root, 'generated/editor/embed.html');
  const manifest = {
    schemaVersion: 1, protocolVersion: 1, packageName: '@drawmotive/editor', packageVersion: '0.2.1',
    privateSource: { commit: 'a'.repeat(40) },
    assets: [{ path: 'editor/embed.html', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }],
  };
  await writeFile(path.join(root, 'generated/editor-manifest.json'), JSON.stringify(manifest));
  await writeFile(file, content);
  await verifyAssets(root);
  await writeFile(file, 'changed');
  await assert.rejects(verifyAssets(root), /integrity/);
  await writeFile(file, content);
  await writeFile(path.join(root, 'generated/editor/unlisted.js'), 'unexpected');
  await assert.rejects(verifyAssets(root), /complete asset tree/);
  await rm(path.join(root, 'generated/editor/unlisted.js'));
  await rm(file);
  await writeFile(path.join(root, 'outside.html'), content);
  await symlink(path.join(root, 'outside.html'), file);
  await assert.rejects(verifyAssets(root), /symbolic links/);
});

test('public browser package has no private runtime-loader or sibling dependency requirement', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@drawmotive/editor');
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.exports['./node'], undefined);
  assert.equal(pkg.exports['./worker'], undefined);
  assert.equal(pkg.dependencies, undefined);
  assert.ok(pkg.files.includes('generated/editor'));
  assert.ok(pkg.files.includes('examples'));
});
