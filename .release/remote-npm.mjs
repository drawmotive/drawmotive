import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { publishNpmArchive } from './release-registry.mjs';

/** Trusted npm identities bind corrections to the existing product workflow.
 * This module is projected standalone, so the authority map travels with it. */
export function npmPublisherIdentity(name) {
  const identities = {
    '@drawmotive/textgraph-fonts': { id: 'textgraph-fonts', workflow: 'release-fonts.yml', productPrefix: 'language-packs/' },
    '@drawmotive/textgraph': { id: 'textgraph', workflow: 'release.yml', productPrefix: '' },
    '@drawmotive/editor': { id: 'editor', workflow: 'publish.yml', productPrefix: '' },
    '@drawmotive/markdown-it-textgraph': { id: 'markdown', workflow: 'release.yml', productPrefix: '' },
  };
  const identity = identities[name]; assert.ok(identity, 'Unknown trusted publication product');
  return { ...identity, workflow: '.github/workflows/' + identity.workflow, versionTag: identity.id + '-v', publisherTag: identity.id + '-publisher-v',
    helperPrefixes: identity.id === 'textgraph-fonts' ? ['language-packs/', ''] : [''] };
}

/** Corrections may add/update publisher transport only. Targets, product bytes,
 * helper deletion and renames cannot borrow an existing tested archive's approval. */
export function validateNpmPublisherChanges(identity, rows) {
  const allowed = new Set([identity.workflow, ...identity.helperPrefixes.flatMap(prefix => ['remote-npm', 'release-registry', 'release-download'].map(helper => prefix + '.release/' + helper + '.mjs'))]);
  assert.ok(rows.length && rows.every(row => { const [status, file, extra] = row.split('\t'); return ['A', 'M'].includes(status) && !extra && allowed.has(file); }), 'Publisher changed tested package inputs');
}

/** A trusted publisher uploads the locally tested, committed archive unchanged.
 * Dispatch inputs bind downloaded draft assets to the reviewed source and hash. */
export async function publishRetainedNpm({ directory, componentRoot, env = process.env, run } = {}) {
  directory = path.resolve(directory); componentRoot = path.resolve(componentRoot);
  const evidence = JSON.parse(await readFile(path.join(directory, env.RECEIPT_FILE), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(componentRoot, 'package.json'), 'utf8'));
  const target = JSON.parse(await readFile(path.join(componentRoot, '.release/target.json'), 'utf8'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: componentRoot, encoding: 'utf8' }).trim();
  const identity = npmPublisherIdentity(pkg.name);
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_SHA, commit);
  if(evidence.publisher) {
    assert.equal(evidence.publisher.commit,commit);
    assert.equal(evidence.publisher.tag, identity.publisherTag + pkg.version + '-' + commit.slice(0,12));
    assert.equal(env.GITHUB_REF,'refs/tags/'+evidence.publisher.tag);
    assert.match(evidence.commits.component, /^[a-f0-9]{40}$/);
    const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: componentRoot, encoding: 'utf8' }).trim();
    try { execFileSync('git', ['cat-file', '-e', evidence.commits.component + '^{commit}'], { cwd: repositoryRoot, stdio: 'pipe' }); }
    catch { execFileSync('git', ['fetch', '--no-tags', 'origin', evidence.commits.component], { cwd: repositoryRoot, stdio: 'pipe' }); }
    // A depth-one checkout may need the immutable original object. An ancestry
    // gap still fails closed; correction workflows must retain full Git history.
    execFileSync('git',['merge-base','--is-ancestor',evidence.commits.component,commit],{cwd:repositoryRoot,stdio:'pipe'});
    const changed=execFileSync('git',['diff','--name-status','--no-renames',evidence.commits.component,commit],{cwd:repositoryRoot,encoding:'utf8'}).trim().split('\n').filter(Boolean);
    validateNpmPublisherChanges(identity, changed);
  } else assert.equal(evidence.commits.component, commit);
  if(!evidence.publisher) assert.equal(env.GITHUB_REF, 'refs/tags/' + identity.versionTag + pkg.version, 'Trusted publication must run on its immutable version tag');
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
