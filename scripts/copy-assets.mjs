#!/usr/bin/env node
import { copyFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAssets } from './verify-assets.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

/** Copy only verified release files into a caller-owned static directory.
 * Unrelated destination files are never removed. */
export async function copyAssets(destination) {
  if (!destination) throw new Error('Usage: drawmotive-copy-assets <public/editor directory>');
  const manifest = await verifyAssets();
  await mkdir(path.resolve(destination), { recursive: true });
  const targetRoot = await realpath(destination);
  const sourceRoot = await realpath(path.join(packageRoot, 'generated/editor'));
  if (targetRoot === sourceRoot || targetRoot.startsWith(sourceRoot + path.sep)) {
    throw new Error('Destination must be outside the package runtime');
  }
  for (const asset of manifest.assets) {
    const relative = asset.path.slice('editor/'.length);
    const target = path.join(targetRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (await realpath(path.dirname(target)) !== path.dirname(target)) throw new Error('Destination must not contain symbolic links');
    try {
      if (await realpath(target) !== target) throw new Error('Destination must not contain symbolic links');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await copyFile(path.join(packageRoot, 'generated', asset.path), target);
  }
  return manifest.assets.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: drawmotive-copy-assets <public/editor directory>');
  console.log('Copied ' + await copyAssets(process.argv[2]) + ' editor runtime assets.');
}
