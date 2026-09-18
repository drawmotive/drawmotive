import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditPackageFiles, auditWasm } from "../scripts/audit-package.mjs";

function leb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
function wasm(section, id = 11) {
  return Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, id]), leb(section.length), section]);
}
function managed({ debugType = 16, resources = 0, pdbStream = false } = {}) {
  const bytes = Buffer.alloc(260);
  bytes.write("WbIL"); bytes.writeUInt16LE(1, 8);
  bytes.writeUInt32LE(0x1000, 12); bytes.writeUInt32LE(72, 16);
  bytes.writeUInt32LE(0x10a0, 20); bytes.writeUInt32LE(28, 24);
  for (const [offset, value] of [[28, 216], [32, 0x1000], [36, 216], [40, 44]]) bytes.writeUInt32LE(value, offset);
  bytes.writeUInt32LE(72, 44); bytes.writeUInt32LE(0x1050, 52); bytes.writeUInt32LE(64, 56);
  bytes.writeUInt32LE(resources, 72);
  const metadata = 124;
  bytes.write("BSJB", metadata); bytes.writeUInt32LE(4, metadata + 12);
  bytes.writeUInt16LE(1, metadata + 22);
  bytes.writeUInt32LE(44, metadata + 24); bytes.writeUInt32LE(4, metadata + 28);
  bytes.write(pdbStream ? "#Pdb" : "#~", metadata + 32);
  bytes.writeUInt32LE(debugType, 216);
  return wasm(bytes);
}

function fixture(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "editor-source-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), bytes);
  }
  return root;
}

test("owned assemblies permit reproducible build metadata but reject symbols and resources", () => {
  assert.deepEqual(auditWasm(managed(), "Editor.Client.abc.wasm"), { managed: true });
  assert.throws(() => auditWasm(managed({ debugType: 2 }), "Editor.Client.abc.wasm"), /retains debug information/);
  assert.throws(() => auditWasm(managed({ resources: 8 }), "Graphics.Core.abc.wasm"), /embeds resources/);
  assert.throws(() => auditWasm(managed({ pdbStream: true }), "Graphics.Core.abc.wasm"), /Portable PDB metadata/);
});

test("third-party CodeView references are allowed but embedded portable PDBs are rejected", () => {
  assert.deepEqual(auditWasm(managed({ debugType: 2 }), "Radzen.Blazor.abc.wasm"), { managed: true });
  assert.throws(() => auditWasm(managed({ debugType: 17 }), "Radzen.Blazor.abc.wasm"), /Embedded portable PDB/);
});

test("native WASM debug sections are rejected and malformed containers fail closed", () => {
  const section = name => Buffer.concat([leb(name.length), Buffer.from(name)]);
  assert.deepEqual(auditWasm(wasm(section("name"), 0), "dotnet.native.wasm"), { managed: false });
  for (const name of [".debug_info", "sourceMappingURL", "external_debug_info"]) assert.throws(() => auditWasm(wasm(section(name), 0), "dotnet.native.wasm"), /debug.source metadata/);
  assert.throws(() => auditWasm(Buffer.from("not wasm"), "dotnet.native.wasm"), /Invalid WASM/);
  assert.throws(() => auditWasm(managed().subarray(0, 50), "Editor.Client.wasm"), /Truncated/);
  assert.throws(() => auditWasm(wasm(section("name"), 0), "Editor.Client.wasm"), /missing its auditable WebCIL/);
});

test("exact file list rejects source, debug files, traversal, duplicates and symlinks", t => {
  const root = fixture(t, { "src/index.js": "export {};", "generated/editor/Editor.Client.wasm": managed() });
  assert.deepEqual(auditPackageFiles(root, ["src/index.js", "generated/editor/Editor.Client.wasm"]), { files: 2, wasmFiles: 1, managedAssemblies: 1 });
  for (const file of ["Program.cs", "Page.razor", "project.csproj", "runtime.pdb", "app.js.map", "SourceLink.json", "obj/cache.json"]) assert.throws(() => auditPackageFiles(root, [file]), /cannot be published/);
  for (const files of [["../secret"], ["src/index.js", "src/index.js"]]) assert.throws(() => auditPackageFiles(root, files), /Unsafe or duplicate/);
  symlinkSync(path.join(root, "src/index.js"), path.join(root, "alias.js"));
  assert.throws(() => auditPackageFiles(root, ["alias.js"]), /regular local files/);
});

test("producer source paths fail while third-party toolchain paths and JS license headers remain distributable", t => {
  const root = fixture(t, {
    "private.js": "/tmp/build/editor.client/Program.cs",
    "private.wide.js": Buffer.from("C:\\Projects\\graphics.core\\Layout.cs", "utf16le"),
    "native.js": "// include: /home/mason/dotnet/native/src/runtime.c\n// Copyright Microsoft Corporation. Licensed under MIT.",
  });
  assert.throws(() => auditPackageFiles(root, ["private.js"]), /Private producer source path/);
  assert.throws(() => auditPackageFiles(root, ["private.wide.js"]), /Private producer source path/);
  assert.equal(auditPackageFiles(root, ["native.js"]).files, 1);
});
