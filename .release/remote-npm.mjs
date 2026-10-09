import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { publishNpmArchive } from './release-registry.mjs';

/** A trusted publisher uploads the locally tested, committed archive unchanged.
 * Dispatch inputs bind downloaded draft assets to the reviewed source and hash. */
export async function publishRetainedNpm({ directory, componentRoot, env = process.env, run } = {}) {
  directory = path.resolve(directory); componentRoot = path.resolve(componentRoot);
  const evidence = JSON.parse(await readFile(path.join(directory, env.RECEIPT_FILE), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(componentRoot, 'package.json'), 'utf8'));
  const target = JSON.parse(await readFile(path.join(componentRoot, '.release/target.json'), 'utf8'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: componentRoot, encoding: 'utf8' }).trim();
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_SHA, commit); assert.equal(evidence.commits.component, commit);
  const prefixes = { '@drawmotive/textgraph-fonts': 'textgraph-fonts-v', '@drawmotive/textgraph': 'textgraph-v', '@drawmotive/editor': 'editor-v', '@drawmotive/markdown-it-textgraph': 'markdown-v' };
  assert.ok(prefixes[pkg.name], 'Unknown trusted publication product');
  assert.equal(env.GITHUB_REF, 'refs/tags/' + prefixes[pkg.name] + pkg.version, 'Trusted publication must run on its immutable version tag');
  assert.equal(pkg.repository.url, 'https://github.com/' + env.GITHUB_REPOSITORY + '.git');
  assert.equal(evidence.receipt.name, pkg.name); assert.equal(evidence.receipt.version, pkg.version);
  assert.equal(target.version, pkg.version); assert.equal(target.publishable, true);
  assert.equal(evidence.receipt.integrity, env.ARTIFACT_INTEGRITY, 'Dispatch archive hash differs');
  assert.equal(evidence.receipt.filename, env.ARCHIVE_FILE, 'Dispatch archive filename differs');
  const errors = createRequire(path.join(componentRoot, 'package.json'))(path.join(componentRoot, '.release/check.cjs')).checkComponent(componentRoot, { ready: true });
  assert.equal(errors.length, 0, errors.join('\n'));
  return publishNpmArchive(evidence.receipt, directory, { run, deferConfirmation: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, componentRoot] = process.argv.slice(2);
  const run = async (command, args, options) => execFileSync(command, [...args, '--provenance'], { ...options, stdio: 'inherit' });
  console.log(JSON.stringify(await publishRetainedNpm({ directory, componentRoot, run }), null, 2));
}
