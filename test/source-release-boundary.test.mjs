import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { verifyAssets } from '../scripts/verify-assets.mjs';
import { checkSource } from '../scripts/check-source.mjs';

const { checkComponent, editorRequiredAssets } = createRequire(import.meta.url)('../.release/check.cjs');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'editor-source-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function write(relative, bytes) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const writeJson = (relative, value) => write(relative, JSON.stringify(value));
  const pkg = { name: '@drawmotive/editor', version: '0.3.2' };
  const target = { schemaVersion: 2, releaseVersion: '0.3.2', channel: 'stable',
    ...pkg, dependencies: {}, native: true, publishable: true, nativeSourceCommit: 'b'.repeat(40) };
  await writeJson('package.json', pkg);
  await writeJson('package-lock.json', { ...pkg, lockfileVersion: 3, packages: { '': pkg } });
  await writeJson('.release/target.json', target);
  await writeJson('.release/plan.json', target);
  const assets = [];
  for (const relative of [...editorRequiredAssets, 'editor/_framework/dotnet.boot.fixture.js',
    'editor/_framework/Editor.Client.fixture.wasm']) {
    const bytes = Buffer.from(relative);
    await write('generated/' + relative, bytes);
    assets.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = { schemaVersion: 1, runtimeVersion: 1,
    packageName: pkg.name, packageVersion: pkg.version,
    privateSource: { commit: 'b'.repeat(40), project: 'Editor.Client' }, assets };
  await writeJson('generated/editor-manifest.json', manifest);
  return { root, write, writeJson, target, manifest };
}

test('verified source assets cannot borrow a different formal native producer', async t => {
  const f = await fixture(t);
  assert.deepEqual(checkComponent(f.root, { ready: true }), []);

  f.target.nativeSourceCommit = 'a'.repeat(40);
  await f.writeJson('.release/target.json', f.target);
  const formalFiles = ['package.json', 'package-lock.json', '.release/target.json', '.release/plan.json', 'generated/editor-manifest.json'];
  const before = await Promise.all(formalFiles.map(file => readFile(path.join(f.root, file))));
  await checkSource(f.root);
  assert.deepEqual(await Promise.all(formalFiles.map(file => readFile(path.join(f.root, file)))), before);
  await verifyAssets(f.root);
  assert.match(checkComponent(f.root, { ready: true }).join('\n'), /native source commit does not match required/);

  await f.write('generated/editor/js/editor-canvas.js', 'tampered');
  await assert.rejects(verifyAssets(f.root), /integrity verification/);
});

for (const [label, remove, diagnostic] of [
  ['required host CSS', 'editor/css/editor-canvas.css', /missing required host asset/],
  ['Blazor boot configuration', 'editor/_framework/dotnet.boot.fixture.js', /missing the Blazor boot configuration/],
]) {
  test('source native verification rejects a manifest omitting ' + label, async t => {
    const f = await fixture(t);
    await rm(path.join(f.root, 'generated', remove));
    f.manifest.assets = f.manifest.assets.filter(asset => asset.path !== remove);
    await f.writeJson('generated/editor-manifest.json', f.manifest);
    await verifyAssets(f.root);
    await assert.rejects(checkSource(f.root), diagnostic);
  });
}

test('source native verification rejects an integrity-valid empty runtime', async t => {
  const f = await fixture(t);
  const asset = f.manifest.assets.find(asset => asset.path.endsWith('.wasm'));
  await f.write('generated/' + asset.path, Buffer.alloc(0));
  asset.bytes = 0;
  asset.sha256 = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  await f.writeJson('generated/editor-manifest.json', f.manifest);
  await verifyAssets(f.root);
  await assert.rejects(checkSource(f.root), /missing nonempty WebAssembly runtime assets/);
});

for (const [label, producer, diagnostic] of [
  ['a foreign project', { commit: 'b'.repeat(40), project: 'Other.Client' }, /provenance must name an exact Editor.Client commit/],
  ['a malformed source SHA', { commit: 'not-a-commit', project: 'Editor.Client' }, /provenance must name an exact Editor.Client commit/],
  ['development assets', { commit: 'b'.repeat(40), project: 'Editor.Client', development: true }, /contains development native assets/],
]) {
  test('source native verification rejects ' + label, async t => {
    const f = await fixture(t);
    f.manifest.privateSource = producer;
    await f.writeJson('generated/editor-manifest.json', f.manifest);
    await assert.rejects(checkSource(f.root), diagnostic);
  });
}

test('source native verification cannot be disabled by declaring a nonnative target', async t => {
  const f = await fixture(t);
  f.target.native = false;
  await f.writeJson('.release/target.json', f.target);
  await assert.rejects(checkSource(f.root), /requires the native @drawmotive.editor target/);
});

test('source native verification rejects a linked generated directory', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await rm(path.join(f.root, 'generated'), { recursive: true });
  await symlink(outside, path.join(f.root, 'generated'), 'junction');
  await assert.rejects(checkSource(f.root), /regular local files and directories/);
});

test('source native verification rejects a linked manifest', {
  skip: process.platform === 'win32' ? 'File symlinks require Windows developer privileges.' : false,
}, async t => {
  const f = await fixture(t);
  await f.writeJson('outside-manifest.json', f.manifest);
  await rm(path.join(f.root, 'generated/editor-manifest.json'));
  await symlink('../outside-manifest.json', path.join(f.root, 'generated/editor-manifest.json'));
  await assert.rejects(checkSource(f.root), /symbolic links/);
});

test('source projections support a linked temporary parent and clean up after validation', async t => {
  const f = await fixture(t);
  const temporary = path.join(f.root, 'temporary');
  const alias = path.join(f.root, 'temporary-alias');
  await mkdir(temporary);
  await symlink(temporary, alias, 'junction');
  const run = () => promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    'const {checkSource}=await import(process.argv[1]);await checkSource(process.argv[2]);',
    new URL('../scripts/check-source.mjs', import.meta.url).href, f.root],
  { env: { ...process.env, TMPDIR: alias, TMP: alias, TEMP: alias } });
  await run();
  assert.deepEqual(await readdir(temporary), []);
  await f.write('generated/editor/js/editor-canvas.js', 'tampered');
  const formalFiles = ['package.json', 'package-lock.json', '.release/target.json', '.release/plan.json', 'generated/editor-manifest.json'];
  const original = await Promise.all(formalFiles.map(file => readFile(path.join(f.root, file))));
  await assert.rejects(run(), /recorded bytes/);
  assert.deepEqual(await readdir(temporary), []);
  assert.deepEqual(await Promise.all(formalFiles.map(file => readFile(path.join(f.root, file)))), original);
});
