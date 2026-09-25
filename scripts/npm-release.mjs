import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkComponent } from "../.release/check.cjs";
import { auditPackageFiles } from "./audit-package.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async file => JSON.parse(await readFile(file, "utf8"));
const registry = "https://registry.npmjs.org/";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-alpha\.(0|[1-9]\d*))?$/;

/** Publish channels are derived from the coordinated version, never CLI defaults. */
export function releasePolicy(pkg, target) {
  assert.equal(pkg.name, "@drawmotive/editor");
  assert.match(pkg.version, versionPattern, "Expected a stable or alpha release version.");
  assert.equal(target.version, pkg.version, "Package version must match the release target.");
  assert.equal(target.releaseVersion, pkg.version, "Coordinated release version must match the package.");
  const alpha = pkg.version.includes("-");
  assert.equal(target.channel, alpha ? "alpha" : "stable", "Release channel/version mismatch.");
  const tag = alpha ? "alpha" : "latest";
  assert.notEqual(pkg.private, true);
  assert.deepEqual(pkg.publishConfig, { access: "public", registry, tag });
  return { name: pkg.name, version: pkg.version, tag, gitTag: `editor-v${pkg.version}`, filename: `drawmotive-editor-${pkg.version}.tgz` };
}

/** The generated target owns package identity and the verified native producer. */
export async function releaseIdentity() {
  const errors = checkComponent(root, { ready: true });
  assert.equal(errors.length, 0, errors.join("\n"));
  return releasePolicy(await readJson(path.join(root, "package.json")), await readJson(path.join(root, ".release/target.json")));
}

/** Branch dispatches may publish without merging; OIDC and the retained archive
 * must still identify the same immutable tested commit. */
export function assertReleaseRef(release, commit, env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "npm publication runs only in GitHub Actions.");
  assert.equal(env.GITHUB_REPOSITORY, "drawmotive/drawmotive");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.ok(env.GITHUB_REF?.startsWith("refs/heads/") || env.GITHUB_REF === `refs/tags/${release.gitTag}`, "Dispatch must select a release branch or matching tag.");
  assert.equal(env.RELEASE_VERSION, release.version, "Requested version must match the verified release.");
  assert.equal(env.GITHUB_SHA, commit);
  assert.match(commit, /^[a-f0-9]{40}$/);
}

async function npm(args) {
  return exec("npm", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
}

export async function verifyArtifact(directory, expected, commit) {
  const receipt = await readJson(path.join(directory, "npm-release.json"));
  for (const key of ["name", "version", "tag", "gitTag", "filename"]) assert.equal(receipt[key], expected[key], `Artifact ${key} mismatch`);
  assert.equal(receipt.commit, commit, "Artifact source commit mismatch");
  const bytes = await readFile(path.join(directory, expected.filename));
  assert.equal(receipt.integrity, `sha512-${createHash("sha512").update(bytes).digest("base64")}`, "Artifact integrity mismatch");
  return receipt;
}

/** Pack only the verified checkout, then bind the archive to its source commit. */
async function pack(release, commit) {
  const errors = checkComponent(root, { installed: true });
  assert.equal(errors.length, 0, errors.join("\n"));
  const directory = path.join(root, ".release");
  await mkdir(directory, { recursive: true });
  const { stdout } = await npm(["pack", "--ignore-scripts", "--json", "--workspaces=false", "--pack-destination", directory]);
  const [packed] = JSON.parse(stdout);
  for (const key of ["name", "version", "filename"]) assert.equal(packed[key], release[key]);
  auditPackageFiles(root, packed.files.map(file => file.path));
  const receipt = { ...release, commit, integrity: packed.integrity };
  await writeFile(path.join(directory, "npm-release.json"), JSON.stringify(receipt, null, 2) + "\n");
  return verifyArtifact(directory, release, commit);
}

/** Exact-version reads and dist-tags are independent registry views. A missing
 * new version may lag publication; visible conflicting bytes are never retried. */
export async function registryState(release, fetchRegistry = fetch) {
  const base = registry + encodeURIComponent(release.name);
  const options = { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) };
  const response = await fetchRegistry(`${base}/${release.version}`, options);
  const published = response.status !== 404;
  if (published) {
    assert.ok(response.ok, `npm version lookup returned HTTP ${response.status}`);
    const metadata = await response.json();
    assert.equal(metadata.name, release.name);
    assert.equal(metadata.version, release.version);
    assert.equal(metadata.dist?.integrity, release.integrity, "Published tarball integrity mismatch");
  }
  // Read channel authority even when this new version does not exist yet.
  // Otherwise publishing an older version could silently move a tag backwards.
  const tags = await fetchRegistry(`${registry}-/package/${encodeURIComponent(release.name)}/dist-tags`, options);
  if (tags.status === 404 && !published) return { published: false, exists: false, tags: {} };
  assert.ok(tags.ok, `npm dist-tags returned HTTP ${tags.status}`);
  const channels = await tags.json();
  assert.ok(channels && typeof channels === "object" && !Array.isArray(channels), "Invalid npm dist-tags");
  return { published, exists: true, tagged: channels[release.tag] === release.version, tags: channels };
}

function compareVersions(left, right) {
  const parse = version => {
    assert.match(version, versionPattern, "Unsupported registry release version");
    return version.split(/\.|-alpha\./).map(BigInt);
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  if (a.length !== b.length) return a.length === 3 ? 1 : -1;
  return a[3] === b[3] ? 0 : a[3] > b[3] ? 1 : -1;
}

/** Refuse both channel rollback and an alpha older than the current stable release. */
function assertRegistryPolicy(release, state) {
  for (const tag of new Set(["latest", release.tag])) {
    const current = state.tags[tag];
    if (current !== undefined) assert.ok(compareVersions(release.version, current) >= 0, `Refusing an older ${tag} release.`);
  }
}

function assertLatestPreserved(release, before, after) {
  if (release.tag !== "alpha" || !after.exists || before.tags.latest === after.tags.latest) return;
  // npm may assign the first package version to latest as well as alpha.
  if (!before.exists && after.tags.latest === release.version) return;
  assert.fail("Alpha publication changed an existing latest; inspect registry state before continuing.");
}

export async function publishArtifact(release, directory, { run = npm, readState = registryState, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const before = await readState(release);
  assertRegistryPolicy(release, before);
  if (before.published) {
    assert.ok(before.tagged, "Published version has a different dist-tag; inspect registry state before changing tags.");
    return "already-published";
  }
  await run(["publish", path.join(directory, release.filename), "--ignore-scripts", "--access", "public", "--tag", release.tag, "--registry", registry, "--provenance"]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const state = await readState(release);
    assertRegistryPolicy(release, state);
    assertLatestPreserved(release, before, state);
    if (state.published && state.tagged) return "published";
    if (attempt < 9) await delay(2000);
  }
  throw new Error("Publication is not visible yet; rerun verification with the same retained artifact.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...extra] = process.argv.slice(2);
  assert.ok(!extra.length && ["check", "pack", "publish"].includes(action), "Usage: node scripts/npm-release.mjs <check|pack|publish>");
  const release = await releaseIdentity();
  const commit = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  assertReleaseRef(release, commit);
  if (action === "check") console.log(JSON.stringify({ ...release, commit }));
  else if (action === "pack") console.log(JSON.stringify(await pack(release, commit), null, 2));
  else {
    const directory = path.join(root, ".release");
    const receipt = await verifyArtifact(directory, release, commit);
    console.log(JSON.stringify({ ...receipt, status: await publishArtifact(receipt, directory) }, null, 2));
  }
}
