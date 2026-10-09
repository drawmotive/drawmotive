import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const registry = 'https://registry.npmjs.org/';
export const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

/** Channel comparisons use integers and explicit stable graduation, never lexical order. */
export function compareReleaseVersions(left, right) {
  const parse = version => {
    assert.match(version, /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(?:-alpha[.](0|[1-9][0-9]*))?$/);
    const [main, alpha] = version.split('-alpha.');
    return [...main.split('.').map(BigInt), alpha === undefined ? 1n : 0n, BigInt(alpha ?? 0)];
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

/** A registry receipt must describe the real archive; visible conflicts fail immediately. */
export async function npmState(receipt, request = fetch) {
  assert.match(receipt.name, /^(?:@[a-z0-9][a-z0-9._-]*[/])?[a-z0-9][a-z0-9._-]*$/);
  compareReleaseVersions(receipt.version, receipt.version);
  assert.equal(receipt.tag, receipt.version.includes('-') ? 'alpha' : 'latest');
  const options = { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000), redirect: 'error' };
  const response = await request(registry + encodeURIComponent(receipt.name) + '/' + receipt.version, options);
  let metadata, archiveAvailable = false;
  if (response.status !== 404) {
    assert.ok(response.ok, 'npm version lookup failed: HTTP ' + response.status);
    metadata = await response.json();
    assert.equal(metadata.name, receipt.name);
    assert.equal(metadata.version, receipt.version);
    assert.equal(metadata.dist?.integrity, receipt.integrity, 'Published npm archive conflicts with the retained artifact');
    assert.equal(metadata.dist?.tarball, `${registry}${receipt.name}/-/${receipt.name.split('/').at(-1)}-${receipt.version}.tgz`);
    const archive = await request(metadata.dist.tarball, { ...options, signal: AbortSignal.timeout(60000) });
    // npm exposes metadata before the asynchronous archive promotion finishes.
    // A 404 is pending evidence, never permission to republish or advance.
    if (archive.status !== 404) {
      assert.ok(archive.ok, 'npm archive lookup failed: HTTP ' + archive.status);
      assert.equal(integrity(Buffer.from(await archive.arrayBuffer())), receipt.integrity, 'Downloaded npm archive differs from retained bytes');
      archiveAvailable = true;
    }
  }
  const tagsResponse = await request(`${registry}-/package/${encodeURIComponent(receipt.name)}/dist-tags`, options);
  const tags = tagsResponse.status === 404 && !metadata ? {} : await (async () => {
    assert.ok(tagsResponse.ok, 'npm channel lookup failed: HTTP ' + tagsResponse.status);
    return tagsResponse.json();
  })();
  assert.ok(tags && typeof tags === 'object' && !Array.isArray(tags));
  for (const tag of new Set(['latest', receipt.tag])) if (tags[tag]) {
    assert.ok(compareReleaseVersions(receipt.version, tags[tag]) >= 0, 'Refusing npm channel rollback: ' + tag);
  }
  return { metadata, tags, archiveAvailable, confirmed: Boolean(metadata && archiveAvailable && tags[receipt.tag] === receipt.version) };
}

/** Hash retained bytes before both first publication and every resume. */
export async function verifyNpmArchive(receipt, directory) {
  assert.match(receipt.filename, /^[A-Za-z0-9_.-]+[.]tgz$/);
  assert.equal(integrity(await readFile(path.join(directory, receipt.filename))), receipt.integrity, 'Retained npm archive changed');
}

/** Publication is irreversible. Only confirmed exact bytes permit the next dependency step. */
export async function publishNpmArchive(receipt, directory, { run, request = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  await verifyNpmArchive(receipt, directory);
  const before = await npmState(receipt, request);
  if (before.metadata) {
    assert.ok(before.confirmed, 'Existing npm version has a different channel; inspect it before continuing');
    return { status: 'already-published', integrity: receipt.integrity };
  }
  await run('npm', ['publish', path.join(directory, receipt.filename), '--ignore-scripts', '--access', 'public', '--tag', receipt.tag, '--registry', registry], { cwd: directory });
  for (let attempt = 0; attempt < 10; attempt++) {
    const after = await npmState(receipt, request);
    if (receipt.tag === 'alpha' && before.tags.latest !== undefined) assert.equal(after.tags.latest, before.tags.latest, 'Alpha publication changed latest');
    if (after.confirmed) return { status: 'published', integrity: receipt.integrity };
    if (attempt < 9) await delay(2000);
  }
  throw new Error('npm publication is not visible; resume with the same retained archive');
}
