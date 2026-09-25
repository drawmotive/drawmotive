import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditManagedResources, auditPackageFiles, auditWasm, readManagedResources } from "../scripts/audit-package.mjs";

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
  assert.throws(() => auditWasm(managed({ resources: 8 }), "Graphics.Core.abc.wasm"), /outside its sections/);
  assert.throws(() => auditWasm(managed({ pdbStream: true }), "Graphics.Core.abc.wasm"), /Portable PDB metadata/);
});

function resourceMetadata(entries, { wide = false, precedingRows = 0 } = {}) {
  const names = [Buffer.from([0])], payload = [], nameIndexes = [], offsets = [];
  let stringSize = 1, resourceSize = 0;
  for (const { name, data } of entries) {
    const text = Buffer.from(name+"\0");nameIndexes.push(stringSize);names.push(text);stringSize += text.length;
    const bytes = Buffer.alloc(Math.ceil((4+data.length)/8)*8);bytes.writeUInt32LE(data.length);data.copy(bytes,4);
    offsets.push(resourceSize);payload.push(bytes);resourceSize += bytes.length;
  }
  const s = wide ? 4 : 2, rowSize = 8+s+2;
  const tables = Buffer.alloc(28+(precedingRows?4+precedingRows*2:0)+entries.length*rowSize);
  tables[6] = wide ? 1 : 0;tables.writeBigUInt64LE((1n<<40n)|(precedingRows?1n<<3n:0n),8);
  let cursor=24;
  if(precedingRows) { tables.writeUInt32LE(precedingRows,cursor);cursor+=4; }
  tables.writeUInt32LE(entries.length,cursor);cursor+=4+precedingRows*2;
  for(let i=0;i<entries.length;i++) {
    tables.writeUInt32LE(offsets[i],cursor);tables.writeUInt32LE(1,cursor+4);
    if(wide) tables.writeUInt32LE(nameIndexes[i],cursor+8);else tables.writeUInt16LE(nameIndexes[i],cursor+8);
    tables.writeUInt16LE(entries[i].external??0,cursor+8+s);cursor+=rowSize;
  }
  return { streams:new Map([["#~",tables],["#Strings",Buffer.concat(names)]]), resources:Buffer.concat(payload) };
}
const groupCss = readFileSync(new URL('./fixtures/GroupThemeDefaults.css',import.meta.url));
const standardCss = Buffer.from('.palette.light { --color-foreground: #000000; }');
const themeEntries = () => [
  {name:'Graphics.Core.Styles.Resources.GroupThemeDefaults.css',data:Buffer.from(groupCss)},
  {name:'Graphics.Core.Styles.Resources.StandardTheme.css',data:Buffer.from(standardCss)},
];
function resourceAssembly({streams,resources}) {
  const streamEntries=[...streams], headers=streamEntries.map(([name])=>Math.ceil((8+name.length+1)/4)*4);
  const headerSize=24+headers.reduce((a,b)=>a+b,0);
  const metadata=Buffer.alloc(headerSize+streamEntries.reduce((n,[,bytes])=>n+bytes.length,0));
  metadata.write('BSJB');metadata.writeUInt32LE(4,12);metadata.writeUInt16LE(streamEntries.length,22);
  let cursor=24,start=headerSize;
  for(let i=0;i<streamEntries.length;i++) {
    const [name,bytes]=streamEntries[i];metadata.writeUInt32LE(start,cursor);metadata.writeUInt32LE(bytes.length,cursor+4);metadata.write(name,cursor+8);
    bytes.copy(metadata,start);start+=bytes.length;cursor+=headers[i];
  }
  const bytes=Buffer.alloc(44+72+metadata.length+resources.length);
  bytes.write('WbIL');bytes.writeUInt16LE(1,8);bytes.writeUInt32LE(0x1000,12);bytes.writeUInt32LE(72,16);
  bytes.writeUInt32LE(bytes.length-44,28);bytes.writeUInt32LE(0x1000,32);bytes.writeUInt32LE(bytes.length-44,36);bytes.writeUInt32LE(44,40);
  bytes.writeUInt32LE(72,44);bytes.writeUInt32LE(0x1048,52);bytes.writeUInt32LE(metadata.length,56);
  bytes.writeUInt32LE(0x1048+metadata.length,68);bytes.writeUInt32LE(resources.length,72);
  metadata.copy(bytes,116);resources.copy(bytes,116+metadata.length);return wasm(bytes);
}

test('reviewed CSS resources use metadata names and match public theme bytes',()=>{
 for(const wide of [false,true]) {
  const fixture=resourceMetadata(themeEntries(),{wide,precedingRows:2});
  assert.deepEqual(readManagedResources(fixture.streams,fixture.resources).map(r=>r.name),themeEntries().map(r=>r.name));
  assert.doesNotThrow(()=>auditManagedResources(fixture.streams,fixture.resources,'Graphics.Core.abc.wasm',standardCss));
  assert.deepEqual(auditWasm(resourceAssembly(fixture),'Graphics.Core.abc.wasm',{publicTheme:standardCss}),{managed:true});
  assert.throws(()=>auditWasm(resourceAssembly(fixture),'Editor.Client.abc.wasm',{publicTheme:standardCss}),/approved resource policy/);
 }
});

test('resource audit rejects source names, changed contents, aliases and hidden payloads',()=>{
 for(const mutate of [
  e=>e[0].name='Graphics.Core.Source.cs', e=>e[0].data=Buffer.from('source disguised as CSS'),
  e=>e[1].data=Buffer.from('changed theme'),e=>e[1].name=e[0].name,e=>e[0].external=4,
 ]) {
  const entries=themeEntries();mutate(entries);const {streams,resources}=resourceMetadata(entries);
  assert.throws(()=>auditManagedResources(streams,resources,'Graphics.Core.wasm',standardCss),/resource|Resource/);
 }
 const {streams,resources}=resourceMetadata(themeEntries());
 assert.throws(()=>auditManagedResources(streams,resources,'Graphics.Core.wasm'),/public theme/);
 assert.throws(()=>auditManagedResources(streams,Buffer.concat([resources,Buffer.from('hidden source')]),'Graphics.Core.wasm',standardCss),/unaccounted/);
 const missing=resourceMetadata(themeEntries().slice(0,1));
 assert.throws(()=>auditManagedResources(missing.streams,missing.resources,'Graphics.Core.wasm',standardCss),/Incomplete/);
 for(const [name,bytes] of streams) {
  const truncated=new Map(streams);truncated.set(name,bytes.subarray(0,bytes.length-1));
  assert.throws(()=>readManagedResources(truncated,resources),/range|Unterminated/);
 }
});

test('package resource approval requires the theme counterpart in its published file list',t=>{
 const filename='generated/editor/_framework/Graphics.Core.abc.wasm',theme='generated/editor/static/themes.css';
 const root=fixture(t,{[filename]:resourceAssembly(resourceMetadata(themeEntries())),[theme]:standardCss});
 assert.equal(auditPackageFiles(root,[filename,theme]).managedAssemblies,1);
 assert.throws(()=>auditPackageFiles(root,[filename]),/public theme/);
 writeFileSync(path.join(root,theme),'changed');
 assert.throws(()=>auditPackageFiles(root,[filename,theme]),/public theme/);
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
