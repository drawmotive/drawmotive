import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

/** Check the package-owned runtime before copying or publishing it. No runtime
 * bytes are rewritten: Blazor's own boot manifest also authenticates them. */
export async function verifyAssets(root = packageRoot) {
  root = await realpath(root);
  const generated = path.join(root, 'generated');
  const manifest = JSON.parse(await readFile(path.join(generated, 'editor-manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.protocolVersion !== 1 ||
      manifest.packageName !== '@drawmotive/editor' || manifest.packageVersion !== pkg.version ||
      !/^[a-f0-9]{40}$/.test(manifest.privateSource?.commit ?? '') || !manifest.assets?.length) {
    throw new Error('Editor runtime manifest does not match this package');
  }
  const listed = new Set();
  for (const asset of manifest.assets) {
    if (!/^editor[/][A-Za-z0-9_@+./-]+$/.test(asset.path) || asset.path.split('/').some(part => !part || part === '.' || part === '..') || listed.has(asset.path)) {
      throw new Error('Unsafe or duplicate editor runtime path');
    }
    listed.add(asset.path);
    const file = path.join(generated, asset.path);
    if (await realpath(file) !== file) throw new Error('Editor runtime assets must not be symbolic links');
    const bytes = await readFile(file);
    if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error('Editor runtime asset failed integrity verification: ' + asset.path);
    }
  }
  async function visit(directory) {
    const files = [];
    for (const entry of await readdir(path.join(generated, directory), { withFileTypes: true })) {
      const relative = directory + '/' + entry.name;
      if (entry.isDirectory()) files.push(...await visit(relative));
      else if (entry.isFile()) files.push(relative);
      else throw new Error('Editor runtime contains a symbolic link or unsupported file');
    }
    return files;
  }
  const actual = await visit('editor');
  if (actual.length !== listed.size || actual.some(file => !listed.has(file)) || !listed.has('editor/embed.html')) {
    throw new Error('Editor runtime manifest must cover the complete asset tree');
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await verifyAssets();
  console.log('Verified ' + manifest.assets.length + ' editor runtime assets.');
}
