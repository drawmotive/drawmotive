import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const { checkComponent } = createRequire(import.meta.url)('../.release/check.cjs');

/** Preserve the complete local input tree, including unlisted files. Reject
 * links before and after copying so a source projection cannot launder them. */
async function assertGeneratedTree(directory) {
  if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
    throw new Error('Source runtime assets must be regular local files and directories.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await assertGeneratedTree(path.join(directory, entry.name));
    else if (!entry.isFile()) throw new Error('Source runtime assets must not contain symbolic links or nonregular files.');
  }
}

/** Source snapshots use the actual native producer in a disposable target.
 * The unchanged release verifier owns every other readiness invariant; formal
 * metadata and publication inputs are never rewritten by this operation. */
export async function checkSource(root = packageRoot) {
  root = await realpath(root);
  const policyErrors = checkComponent(root);
  if (policyErrors.length) throw new Error(policyErrors.join('\n'));
  const target = JSON.parse(await readFile(path.join(root, '.release/target.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (target.name !== '@drawmotive/editor' || pkg.name !== target.name || target.native !== true)
    throw new Error('Source runtime validation requires the native @drawmotive/editor target.');
  const generated = path.join(root, 'generated');
  await assertGeneratedTree(generated);
  const manifest = JSON.parse(await readFile(path.join(generated, 'editor-manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(manifest.privateSource?.commit ?? ''))
    throw new Error('Editor native source provenance must name an exact Editor.Client commit.');

  const stage = await realpath(await mkdtemp(path.join(tmpdir(), 'drawmotive-editor-source-check-')));
  try {
    for (const file of ['package.json', 'package-lock.json'])
      await cp(path.join(root, file), path.join(stage, file), { dereference: false });
    await cp(generated, path.join(stage, 'generated'), { recursive: true, dereference: false });
    await assertGeneratedTree(path.join(stage, 'generated'));
    await mkdir(path.join(stage, '.release'));
    await writeFile(path.join(stage, '.release/target.json'), JSON.stringify({
      ...target, nativeSourceCommit: manifest.privateSource.commit,
    }));
    const errors = checkComponent(stage, { ready: true });
    if (errors.length) throw new Error(errors.join('\n'));
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: npm run source:check');
    const manifest = await checkSource();
    console.log('Verified source runtime from ' + manifest.privateSource.commit + '; formal release metadata is unchanged.');
  } catch (error) {
    console.error('Source check: ' + error.message);
    process.exitCode = 1;
  }
}
