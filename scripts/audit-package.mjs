import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * Reject embedded PDBs for every assembly and producer symbols/resources for
 * private assemblies. Third-party CodeView paths/checksums are not source. */
function auditWebcil(bytes, owned) {
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
  if (owned && u32(bytes, cli + 28)) throw new Error("Private assembly embeds resources; review and remove source-bearing resources before release");
  const metadataSize = u32(bytes, cli + 12);
  const metadata = offset(u32(bytes, cli + 8), metadataSize);
  const data = bytes.subarray(metadata, metadata + metadataSize);
  if (data.subarray(0, 4).toString("ascii") !== "BSJB") throw new Error("Invalid CLI metadata");
  let cursor = 16 + u32(data, 12);
  const streams = u16(data, cursor + 2);
  cursor += 4;
  for (let i = 0; i < streams; i++) {
    requireBytes(data, u32(data, cursor), u32(data, cursor + 4));
    cursor += 8;
    const end = data.indexOf(0, cursor);
    if (end < cursor || end > cursor + 32) throw new Error("Invalid CLI metadata stream");
    if (data.subarray(cursor, end).toString("ascii") === "#Pdb") throw new Error("Portable PDB metadata is not publishable");
    cursor = Math.ceil((end + 1) / 4) * 4;
  }
}

/** Inspect the container instead of searching for marker byte strings, which
 * can occur legitimately inside compiled code and are not proof of symbols. */
export function auditWasm(bytes, filename) {
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
        auditWebcil(section.subarray(webcil), ownedAssembly.test(path.basename(filename)));
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
        const result = auditWasm(bytes, file);
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
