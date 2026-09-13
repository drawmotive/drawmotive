const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** Standalone copies consume a committed release projection. Metadata checks
 * describe the intended release; ready/installed checks forbid packaging old
 * dependencies or presenting an old native build as the intended release. */
function checkComponent(root, { ready = false, installed = false } = {}) {
  const errors = [];
  ready ||= installed;
  const report = message => errors.push(message);
  const readJson = (file, label) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { report(`${label}: cannot read valid JSON (${error.code ?? error.message}).`); return undefined; }
  };
  try { root = fs.realpathSync(root); }
  catch { return ["Component directory does not exist."]; }
  const target = readJson(path.join(root, ".release/target.json"), "Release target");
  const pkg = readJson(path.join(root, "package.json"), "Package manifest");
  if (!record(target) || !record(pkg)) {
    if (target !== undefined && !record(target)) report("Release target must be an object.");
    if (pkg !== undefined && !record(pkg)) report("Package manifest must be an object.");
    return errors;
  }
  if (target.schemaVersion !== 1) report("Release target schemaVersion must be 1; regenerate the projection from the root release authority.");
  for (const field of ["releaseVersion", "version"]) {
    if (typeof target[field] !== "string" || !versionPattern.test(target[field])) report(`Release target ${field} must be an exact semantic version.`);
  }
  if (!["stable", "alpha", "prerelease"].includes(target.channel)) report("Release target channel must be stable, alpha, or prerelease.");
  if (target.channel === "stable" && [target.releaseVersion, target.version].some(value => typeof value === "string" && value.includes("-"))) report("Stable release targets cannot contain prerelease versions.");
  if (typeof target.name !== "string" || !packagePattern.test(target.name)) report("Release target name must be a valid package name.");
  if (pkg.name !== target.name) report(`Package name ${pkg.name} does not match release target ${target.name}.`);
  for (const field of ["native", "publishable"]) if (typeof target[field] !== "boolean") report(`Release target ${field} must be a boolean.`);
  if (!record(target.dependencies)) report("Release target dependencies must be an object of exact internal versions.");
  else for (const [name, version] of Object.entries(target.dependencies)) {
    if (!packagePattern.test(name) || typeof version !== "string" || !versionPattern.test(version)) report(`Release dependency ${name} must have a valid name and exact semantic version.`);
  }
  if (target.nativeSourceCommit !== undefined && !/^[a-f0-9]{40}$/.test(target.nativeSourceCommit)) report("Release target nativeSourceCommit must be an exact 40-character Git commit.");
  if (target.excludedReason !== undefined && (typeof target.excludedReason !== "string" || !target.excludedReason.trim())) report("Release target excludedReason must be nonempty text.");
  if (errors.length || !ready) return errors;
  if (!target.publishable) {
    report(`Component ${target.name} is not publishable in release ${target.releaseVersion}: ${target.excludedReason ?? "explicitly excluded by the release authority"}.`);
    return errors;
  }
  if (pkg.version !== target.version) report(`Package version ${pkg.version} does not match target ${target.version}; synchronize release metadata before packaging.`);
  const lock = readJson(path.join(root, "package-lock.json"), "npm lockfile");
  const lockedRoot = record(lock?.packages) ? lock.packages[""] : undefined;
  if (!record(lock) || !record(lockedRoot)) report("npm lockfile must contain its root package entry; regenerate it with npm from the public registry.");
  else {
    if (lock.name !== target.name || lockedRoot.name !== target.name) report("npm lockfile package name does not match the release target.");
    if (lock.version !== target.version || lockedRoot.version !== target.version) report("npm lockfile root version does not match the release target; regenerate release metadata.");
  }
  for (const [name, expected] of Object.entries(target.dependencies)) {
    const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].filter(section => record(pkg[section]) && has(pkg[section], name));
    if (!sections.length || sections.some(section => pkg[section][name] !== expected)) report(`Declare ${name} at exact version ${expected}; ranges, file dependencies, and workspace substitutions are not release inputs.`);
    for (const section of sections) if (lockedRoot?.[section]?.[name] !== expected) report(`npm lockfile ${section}.${name} must be ${expected}; regenerate it after the public dependency is published.`);
    const entry = lock?.packages?.[`node_modules/${name}`];
    if (!record(entry) || entry.version !== expected || entry.link) report(`npm lockfile must resolve ${name}@${expected} as a public registry package, not a workspace or file link.`);
    if (!registryTarball(entry?.resolved, name, expected) || !validIntegrity(entry?.integrity)) report(`npm lockfile ${name}@${expected} needs its real npm registry tarball URL and integrity; publish the dependency and regenerate the lockfile instead of relabeling old bytes.`);
    if (installed) verifyInstalled(root, name, expected, readJson, report);
  }
  if (target.native) {
    if (!target.nativeSourceCommit) report("Native release target requires nativeSourceCommit; set the verified source commit before preparing native assets.");
    verifyNative(root, target.name, target.version, target.nativeSourceCommit, readJson, report);
  }
  return errors;
}

function registryTarball(value, name, version) {
  try {
    const url = new URL(value);
    const leaf = name.split("/").at(-1);
    return url.protocol === "https:" && url.hostname === "registry.npmjs.org" && !url.port && !url.username && !url.password && !url.search && !url.hash
      && decodeURIComponent(url.pathname) === `/${name}/-/${leaf}-${version}.tgz`;
  } catch { return false; }
}

function validIntegrity(value) {
  if (typeof value !== "string") return false;
  return value.split(/\s+/).some(token => {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    if (!match) return false;
    const bytes = Buffer.from(match[2], "base64");
    return bytes.length === Number(match[1].slice(3)) / 8 && bytes.toString("base64") === match[2];
  });
}

/** A local directory containing a stale SDK must not win over a newly edited
 * dependency declaration. Resolve exactly as Node will, then check native bytes. */
function verifyInstalled(root, name, expected, readJson, report) {
  const packageRoot = path.join(root, "node_modules", name);
  try {
    if (fs.realpathSync(packageRoot) !== packageRoot) {
      report(`Installed ${name} is a symlink/workspace package; install the locked public registry dependency locally.`);
      return;
    }
  } catch { report(`Installed ${name}@${expected} is missing; run npm ci in this component after its public release.`); return; }
  const installed = readJson(path.join(packageRoot, "package.json"), `Installed ${name} manifest`);
  if (installed?.name !== name || installed?.version !== expected) report(`Installed ${name} version ${installed?.version} does not match ${expected}; run npm ci before building.`);
  if (name !== "@drawmotive/textgraph") return;
  try {
    const entry = createRequire(path.join(root, "package.json")).resolve("@drawmotive/textgraph/node");
    const relative = path.relative(packageRoot, fs.realpathSync(entry));
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) report("Node resolves TextGraph outside the component registry installation; remove workspace/local substitutions.");
  } catch (error) { report(`Installed TextGraph Node entry cannot be resolved (${error.code ?? error.message}).`); }
  verifyNative(packageRoot, name, expected, undefined, readJson, report);
}

/** Package identity never changes native provenance. Hashes and the required
 * producer commit must describe the existing files; this gate rewrites nothing. */
function verifyNative(root, name, expected, sourceCommit, readJson, report) {
  const generated = path.join(root, "generated");
  const manifest = readJson(path.join(generated, "wasm-manifest.json"), `${name} native manifest`);
  if (!record(manifest)) { if (manifest !== undefined) report(`${name} native manifest must be an object.`); return; }
  if (manifest.packageName !== name || manifest.packageVersion !== expected) report(`${name} native manifest identity must match ${name}@${expected}; prepare and verify the intended native release.`);
  if (!/^[a-f0-9]{40}$/.test(manifest.privateSource?.commit ?? "")) report(`${name} native source provenance is missing or invalid.`);
  if (sourceCommit && manifest.privateSource?.commit !== sourceCommit) report(`${name} native source commit ${manifest.privateSource?.commit} does not match required ${sourceCommit}; changing packageVersion cannot supply the intended native build.`);
  const projection = path.join(generated, "wasm-manifest.js");
  if (fs.existsSync(projection)) {
    try {
      if (fs.readFileSync(projection, "utf8") !== `export default ${JSON.stringify(manifest, null, 2)};\n`) report(`${name} native JS manifest projection differs from its JSON authority.`);
    } catch (error) { report(`${name} native JS projection cannot be read (${error.code ?? error.message}).`); }
  }
  if (!Array.isArray(manifest.assets) || !manifest.assets.length) { report(`${name} native manifest must list its assets.`); return; }
  const seen = new Set();
  for (const asset of manifest.assets) {
    if (!record(asset) || typeof asset.path !== "string" || !/^wasm\/[A-Za-z0-9_.-]+$/.test(asset.path) || [".", ".."].includes(asset.path.slice(5)) || seen.has(asset.path)) { report(`${name} native manifest has an unsafe or duplicate asset path.`); continue; }
    seen.add(asset.path);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) { report(`${name} asset ${asset.path} lacks valid byte length/SHA-256.`); continue; }
    const file = path.join(generated, asset.path);
    try {
      if (fs.realpathSync(file) !== file) { report(`${name} asset ${asset.path} must not reference a symlink or external native file.`); continue; }
      const bytes = fs.readFileSync(file);
      if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) report(`${name} asset ${asset.path} does not match its recorded bytes/SHA-256; restore the verified public assets.`);
    } catch (error) { report(`${name} asset ${asset.path} cannot be read (${error.code ?? error.message}).`); }
  }
  try {
    const disk = fs.readdirSync(path.join(generated, "wasm")).map(file => `wasm/${file}`);
    if (disk.length !== seen.size || disk.some(file => !seen.has(file))) report(`${name} native assets include unmanifested files; regenerate and verify the native release.`);
  } catch (error) { report(`${name} native asset directory cannot be read (${error.code ?? error.message}).`); }
}

module.exports = { checkComponent };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--ready", "--installed"].includes(arg))) {
    console.error("Usage: node .release/check.cjs [--ready] [--installed]");
    process.exitCode = 1;
  } else {
    const errors = checkComponent(path.dirname(__dirname), { ready: args.includes("--ready"), installed: args.includes("--installed") });
    if (errors.length) { for (const error of errors) console.error(`Release check: ${error}`); process.exitCode = 1; }
  }
}
