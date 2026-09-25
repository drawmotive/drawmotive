import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Reviewed against Graphics.Core resources at producer commit 166386683b3b90a4917eb4cfc1a04361b30f1710.
// StandardTheme has a public byte-for-byte counterpart; additive defaults do not.
const groupDefaultsHash = "27496b24a6086fa1b45e78c7f9fe07ce431533647ea51acda71d0df63a5deecb";
const prefix = "Graphics.Core.Styles.Resources.";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function range(bytes, offset, size) {
  requireBytes(bytes, offset, size);
  return bytes.subarray(offset, offset + size);
}

/** Locate ManifestResource rows using ECMA-335 table widths. Names must come
 * from metadata, not byte searches that could mistake source data for authority. */
export function readManagedResources(streams, resources) {
  const tables = streams.get("#~") ?? streams.get("#-");
  const strings = streams.get("#Strings");
  if (!tables || !strings) throw new Error("Missing managed resource metadata tables");
  range(tables, 0, 24);
  const valid = tables.readBigUInt64LE(8), rows = Array(64).fill(0);
  let cursor = 24;
  for (let id = 0; id < 64; id++) if (valid & (1n << BigInt(id))) { rows[id] = u32(tables, cursor); cursor += 4; }
  const index = id => rows[id] < 65536 ? 2 : 4;
  const coded = (bits, ids) => Math.max(...ids.map(id => rows[id])) < 2 ** (16 - bits) ? 2 : 4;
  const s = tables[6] & 1 ? 4 : 2, g = tables[6] & 2 ? 4 : 2, b = tables[6] & 4 ? 4 : 2;
  const type = coded(2, [2, 1, 27]);
  const implementation = coded(2, [38, 35, 39]);
  const widths = [
    2+s+3*g, coded(2,[0,26,35,1])+2*s, 4+2*s+type+index(4)+index(6), index(4), 2+s+b, index(6),
    8+s+b+index(8), index(8), 4+s, index(2)+type, coded(3,[2,1,26,6,27])+s+b,
    2+coded(2,[4,8,23])+b, coded(5,[6,4,1,2,8,9,10,0,14,23,20,17,26,27,32,35,38,39,40,42,44,43])+coded(3,[6,10])+b,
    coded(1,[4,8])+b, 2+coded(2,[2,6,32])+b, 6+index(2), 4+index(4), b, index(2)+index(20), index(20),
    2+s+type, index(2)+index(23), index(23), 2+s+b, 2+index(6)+coded(1,[20,23]),
    index(2)+2*coded(1,[6,10]), s, b, 2+coded(1,[4,6])+s+index(26), 4+index(4), 8, 4,
    16+b+2*s, 4, 12, 12+2*b+2*s, 4+index(35), 12+index(35), 4+s+b, 8+2*s+implementation,
  ];
  for (let id = 0; id < 40; id++) { range(tables, cursor, rows[id] * widths[id]); cursor += rows[id] * widths[id]; }
  const result = [];
  for (let row = 0; row < rows[40]; row++) {
    range(tables, cursor, 8+s+implementation);
    const offset = u32(tables, cursor);
    const nameIndex = s === 2 ? tables.readUInt16LE(cursor+8) : u32(tables,cursor+8);
    const external = implementation === 2 ? tables.readUInt16LE(cursor+8+s) : u32(tables,cursor+8+s);
    if (external !== 0) throw new Error("External managed resources are not approved");
    range(strings, nameIndex, 1);
    const end = strings.indexOf(0, nameIndex);
    if (end < nameIndex) throw new Error("Unterminated managed resource name");
    const name = strings.subarray(nameIndex,end).toString("utf8");
    const size = u32(resources, offset);
    result.push({ name, offset, data: range(resources,offset+4,size) });
    cursor += 8+s+implementation;
  }
  return result;
}

/** Only reviewed runtime CSS may enter owned assemblies. Reject unknown names,
 * changed payloads, duplicate entries and hidden bytes outside resource rows. */
export function auditManagedResources(streams, resources, filename, publicTheme) {
  if (!/^Graphics\.Core(?:\.[A-Za-z0-9_-]+)?\.wasm$/.test(path.basename(filename))) throw new Error("Private assembly embeds resources without an approved resource policy");
  const entries = readManagedResources(streams, resources);
  const names = new Set();
  let end = 0;
  for (const resource of entries.sort((a,b)=>a.offset-b.offset)) {
    if (names.has(resource.name)) throw new Error("Duplicate managed resource name");
    names.add(resource.name);
    if (resource.offset < end || resource.offset-end > 7 || range(resources,end,resource.offset-end).some(byte=>byte!==0)) throw new Error("Unaccounted managed resource bytes");
    if (resource.name === prefix+"GroupThemeDefaults.css") {
      if (hash(resource.data) !== groupDefaultsHash) throw new Error("Unreviewed GroupThemeDefaults.css resource contents");
    } else if (resource.name === prefix+"StandardTheme.css") {
      if (!publicTheme || !resource.data.equals(publicTheme)) throw new Error("StandardTheme.css resource differs from the shipped public theme");
    } else throw new Error("Unapproved managed resource: "+resource.name);
    end = resource.offset+4+resource.data.length;
  }
  if (names.size !== 2 || resources.length-end > 7 || range(resources,end,resources.length-end).some(byte=>byte!==0)) throw new Error("Incomplete or unaccounted managed resources");
}

const ownedAssembly = /^(?:Editor\.Client|Graphics\.Core|Blazor\.IndexedDB|Math\.Core|RBush)(?:\.[A-Za-z0-9_-]+)?\.wasm$/;
const forbiddenFile = /(?:\.(?:cs|csx|razor|cshtml|csproj|fsproj|vbproj|sln|slnx|pdb|mdb|map|dbg|symbols|props|targets)$|(?:^|[/])(?:obj|bin|\.git|source|sources)(?:[/]|$)|sourcelink)/i;
const privateSourcePath = /(?:[/]home[/][^\0\r\n]+|[/]tmp[/][^\0\r\n]+|[A-Za-z]:\\[^\0\r\n]+)[\\/](?:editor\.client|graphics\.core|graphics\.core\.generator|Blazor\.IndexedDB)[\\/][^\0\r\n]*\.(?:cs|razor|csproj)(?:\0|[\r\n]|$)/i;

function requireBytes(bytes, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > bytes.length - length) throw new Error("Truncated or invalid binary range");
}
function u16(bytes, offset) { requireBytes(bytes, offset, 2); return bytes.readUInt16LE(offset); }
function u32(bytes, offset) { requireBytes(bytes, offset, 4); return bytes.readUInt32LE(offset); }
function leb(bytes, offset) {
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    requireBytes(bytes, offset, 1);
    const byte = bytes[offset++];
    value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) { if (value > 0xffffffff) throw new Error("Invalid WASM integer"); return [value, offset]; }
  }
  throw new Error("Invalid WASM integer");
}

/** WebCIL preserves PE CLI/debug directories inside a WASM data segment.
 * Reject embedded PDBs for every assembly and producer symbols/unapproved
 * resources for private assemblies. Third-party CodeView paths are not source. */
function auditWebcil(bytes, owned, filename, publicTheme) {
  const sections = u16(bytes, 8);
  if (!sections || sections > 100 || u16(bytes, 4) !== 0 || u16(bytes, 6) !== 0) throw new Error("Unsupported WebCIL header");
  requireBytes(bytes, 28, sections * 16);
  function offset(rva, size) {
    for (let i = 0; i < sections; i++) {
      const pos = 28 + i * 16;
      const address = u32(bytes, pos + 4), rawSize = u32(bytes, pos + 8), rawOffset = u32(bytes, pos + 12);
      if (rva >= address && rva - address <= rawSize && size <= rawSize - (rva - address)) {
        const result = rawOffset + rva - address;
        requireBytes(bytes, result, size);
        return result;
      }
    }
    throw new Error("WebCIL directory is outside its sections");
  }
  const debugSize = u32(bytes, 24);
  if (debugSize % 28) throw new Error("Invalid WebCIL debug directory");
  if (debugSize) {
    const debug = offset(u32(bytes, 20), debugSize);
    for (let entry = debug; entry < debug + debugSize; entry += 28) {
      const type = u32(bytes, entry + 12);
      if (type === 17) throw new Error("Embedded portable PDB is not publishable");
      if (owned && ![0, 16].includes(type)) throw new Error("Private assembly retains debug information");
    }
  }
  const cli = offset(u32(bytes, 12), u32(bytes, 16));
  requireBytes(bytes, cli, 32);
  const resourceSize = u32(bytes, cli + 28);
  const metadataSize = u32(bytes, cli + 12);
  const metadata = offset(u32(bytes, cli + 8), metadataSize);
  const data = bytes.subarray(metadata, metadata + metadataSize);
  if (data.subarray(0, 4).toString("ascii") !== "BSJB") throw new Error("Invalid CLI metadata");
  let cursor = 16 + u32(data, 12);
  const streams = u16(data, cursor + 2);
  const metadataStreams = new Map();
  cursor += 4;
  for (let i = 0; i < streams; i++) {
    const start = u32(data, cursor), size = u32(data, cursor + 4);
    requireBytes(data, start, size);
    cursor += 8;
    const end = data.indexOf(0, cursor);
    if (end < cursor || end > cursor + 32) throw new Error("Invalid CLI metadata stream");
    const name = data.subarray(cursor, end).toString("ascii");
    if (name === "#Pdb") throw new Error("Portable PDB metadata is not publishable");
    if (metadataStreams.has(name)) throw new Error("Duplicate CLI metadata stream");
    metadataStreams.set(name, data.subarray(start, start + size));
    cursor = Math.ceil((end + 1) / 4) * 4;
  }
  if (owned && resourceSize) {
    const start = offset(u32(bytes, cli + 24), resourceSize);
    auditManagedResources(metadataStreams, bytes.subarray(start, start + resourceSize), filename, publicTheme);
  }
}

/** Inspect the container instead of searching for marker byte strings, which
 * can occur legitimately inside compiled code and are not proof of symbols. */
export function auditWasm(bytes, filename, { publicTheme } = {}) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error("Invalid WASM header");
  let position = 8, managed = 0;
  while (position < bytes.length) {
    const id = bytes[position++];
    let length;
    [length, position] = leb(bytes, position);
    requireBytes(bytes, position, length);
    const section = bytes.subarray(position, position + length);
    if (id === 0) {
      const [nameLength, start] = leb(section, 0);
      requireBytes(section, start, nameLength);
      const name = section.subarray(start, start + nameLength).toString("utf8");
      if (/debug|sourceMappingURL|sourceURL/i.test(name)) throw new Error("WASM contains debug/source metadata: " + name);
    }
    if (id === 11) {
      const webcil = section.indexOf("WbIL", 0, "ascii");
      if (webcil >= 0) {
        auditWebcil(section.subarray(webcil), ownedAssembly.test(path.basename(filename)), filename, publicTheme);
        managed++;
      }
    }
    position += length;
  }
  if (ownedAssembly.test(path.basename(filename)) && managed !== 1) throw new Error("Private assembly is missing its auditable WebCIL payload");
  return { managed: managed > 0 };
}

/** Audit the exact npm pack file list before publication. Compiled managed IL
 * remains decompilable; this gate prevents shipping source files and symbols. */
export function auditPackageFiles(root, relativePaths) {
  root = realpathSync(root);
  const publicThemePath = "generated/editor/static/themes.css";
  const publicTheme = relativePaths.includes(publicThemePath) ? readFileSync(path.join(root, publicThemePath)) : undefined;
  const seen = new Set();
  let wasmFiles = 0, managedAssemblies = 0;
  for (const file of relativePaths) {
    if (typeof file !== "string" || path.isAbsolute(file) || file.includes("\\") || file.split("/").some(part => !part || part === "." || part === "..") || seen.has(file)) throw new Error("Unsafe or duplicate package path");
    seen.add(file);
    if (forbiddenFile.test(file)) throw new Error("Source/debug file cannot be published: " + file);
    const absolute = path.join(root, file);
    if (realpathSync(absolute) !== absolute || !statSync(absolute).isFile()) throw new Error("Package files must be regular local files: " + file);
    const bytes = readFileSync(absolute);
    if (privateSourcePath.test(bytes.toString("utf8")) || privateSourcePath.test(bytes.toString("utf16le"))) throw new Error("Private producer source path appears in " + file);
    if (file.endsWith(".wasm")) {
      try {
        const result = auditWasm(bytes, file, { publicTheme });
        wasmFiles++;
        if (result.managed) managedAssemblies++;
      } catch (error) { throw new Error(`${file}: ${error.message}`); }
    }
  }
  return { files: seen.size, wasmFiles, managedAssemblies };
}

/** --ignore-scripts prevents recursion when this is invoked by prepack. */
export function auditPackage(root = fileURLToPath(new URL("../", import.meta.url))) {
  const command = process.platform === "win32" ? process.execPath : "npm";
  const args = ["pack", "--dry-run", "--ignore-scripts", "--json"];
  if (process.platform === "win32") args.unshift(process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"));
  const packed = JSON.parse(execFileSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  if (packed.length !== 1 || !Array.isArray(packed[0].files)) throw new Error("Unexpected npm pack file list");
  return auditPackageFiles(root, packed[0].files.map(file => file.path));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error("Usage: node scripts/audit-package.mjs [PACKAGE_ROOT]");
  console.log(JSON.stringify(auditPackage(process.argv[2]), null, 2));
}
