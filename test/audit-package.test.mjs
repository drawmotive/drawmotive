import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resourceMetadata, resourceAssembly } from "./fixtures/managed-resources.mjs";
import { auditManagedResources, auditPackageFiles, auditWasm, readManagedResources } from "../scripts/audit-package.mjs";

function leb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
test("npm archive rejects private UI source and stale chrome build artifacts", t => {
  for (const file of ["src/react/index.tsx", "src/controls.tsx", "src/styles.css", "dist/editor-ui.js", "dist/editor-ui.css", "dist/react.js", "dist/renamed-ui.js"]) {
    const root = fixture(t, { [file]: "export {};" });
    assert.throws(() => auditPackageFiles(root, [file]), /Private UI/);
  }
});
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

const groupCss = readFileSync(new URL('./fixtures/GroupThemeDefaults.css',import.meta.url));
const standardCss = Buffer.from('.palette.light { --color-foreground: #000000; }');
const themeEntries = () => [
  {name:'Graphics.Core.Styles.Resources.GroupThemeDefaults.css',data:Buffer.from(groupCss)},
  {name:'Graphics.Core.Styles.Resources.StandardTheme.css',data:Buffer.from(standardCss)},
];
const catalogName = 'Editor.Client.Licensing.editor-license-public-keys.json';
const publicCatalog = JSON.parse(readFileSync(new URL('./fixtures/editor-license-public-keys.json',import.meta.url)));
const catalogEntry = value => ({name:catalogName,data:Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value))});
const shapeEntries = () => ['capsule', 'cloud', 'star'].map(shape => ({
  name: `Graphics.Core.Shapes.Resources.${shape}.v2.json`,
  data: readFileSync(new URL(`./fixtures/shapes/${shape}.v2.json`, import.meta.url)),
}));

test('editor resources accept only public P-256 catalogs and permit explicit key rotation',()=>{
 for(const keys of [[],publicCatalog.keys,[...publicCatalog.keys,{...publicCatalog.keys[0],kid:'rotated public key α'}]]) {
  for(const data of [JSON.stringify({keys}),JSON.stringify({keys},null,2)+'\n']) {
   const fixture=resourceMetadata([catalogEntry(Buffer.from(data))]);
   assert.deepEqual(auditWasm(resourceAssembly(fixture),'Editor.Client.abc.wasm'),{managed:true});
  }
 }
});

test('catalog approval rejects secret fields, invalid keys and ambiguous JSON without echoing payloads',()=>{
 const key=publicCatalog.keys[0],secret='private-secret-must-not-be-printed';
 const invalid=[null,[],{}, {keys:{}},{keys:[null]}, {keys:[{kid:key.kid,x:key.x}]},
  {keys:[],token:secret},{keys:[{...key,d:secret}]},{keys:[{...key,credentials:secret}]},
  {keys:[key,key]},...['',' ','x'.repeat(257),'key\n'].map(kid=>({keys:[{...key,kid}]})),
  {keys:[{...key,x:42}]},{keys:[{...key,x:key.x+'='}]},{keys:[{...key,x:key.x.slice(0,-1)+'Z'}]},
  {keys:[{...key,x:'A'.repeat(43),y:'A'.repeat(43)}]},
 ].map(value=>Buffer.from(JSON.stringify(value)));
 invalid.push(Buffer.from('{"keys":[],'+JSON.stringify(publicCatalog).slice(1)),
  Buffer.from('{"keys":[],"k'+String.fromCharCode(92)+'u0065ys":'+JSON.stringify(publicCatalog.keys)+'}'),
  Buffer.from('{"keys":[{"kid":"discarded",'+JSON.stringify(key).slice(1)+']}'),
  Buffer.from('{"keys":[] } '+secret),Buffer.from([0xff]));
 for(const data of invalid) {
  const fixture=resourceMetadata([catalogEntry(data)]);
  assert.throws(()=>auditWasm(resourceAssembly(fixture),'Editor.Client.wasm'),error=>{
   assert.match(error.message,/license.*catalog.*contents/i);assert.ok(!error.message.includes(secret));return true;
  });
 }
});

test('catalog resources retain exact assembly ownership, metadata identity and complete byte accounting',()=>{
 for(const entries of [[{...catalogEntry(publicCatalog),name:'Editor.Client.Licensing.renamed.json'}],
  [catalogEntry(publicCatalog),catalogEntry(publicCatalog)],
  [catalogEntry(publicCatalog),{name:'Editor.Client.Private.json',data:Buffer.from('{}')}],[]]) {
  const fixture=resourceMetadata(entries);
  assert.throws(()=>auditManagedResources(fixture.streams,fixture.resources,'Editor.Client.wasm'),/resource|Resource/);
 }
 const fixture=resourceMetadata([catalogEntry(publicCatalog)]);
 assert.throws(()=>auditManagedResources(fixture.streams,fixture.resources,'Graphics.Core.wasm',standardCss),/Unapproved managed resource/);
 assert.throws(()=>auditManagedResources(fixture.streams,fixture.resources,'Math.Core.wasm'),/approved resource policy/);
 assert.throws(()=>auditManagedResources(fixture.streams,Buffer.concat([fixture.resources,Buffer.from('hidden')]),'Editor.Client.wasm'),/unaccounted/);
});

test('graphics resources approve exact reviewed built-ins while rejecting changed or aliased shape payloads',()=>{
 const shapes=shapeEntries();
 const complete=resourceMetadata([...themeEntries(),...shapes]);
 assert.deepEqual(auditWasm(resourceAssembly(complete),'Graphics.Core.abc.wasm',{publicTheme:standardCss}),{managed:true});
 for(const shape of shapes) {
  for(const changed of [{...shape,name:shape.name.replace('.v2.','.v3.')},
   {...shape,data:Buffer.from(JSON.stringify({...JSON.parse(shape.data),credentials:'secret'}))}]) {
   const fixture=resourceMetadata([...themeEntries(),...shapes.map(entry=>entry===shape?changed:entry)]);
   assert.throws(()=>auditWasm(resourceAssembly(fixture),'Graphics.Core.wasm',{publicTheme:standardCss}),/Unapproved|Unreviewed/);
  }
 }
 const missingCss=resourceMetadata(shapes);
 assert.throws(()=>auditManagedResources(missingCss.streams,missingCss.resources,'Graphics.Core.wasm',standardCss),/Incomplete/);
});
test('reviewed CSS resources use metadata names and match public theme bytes',()=>{
 for(const wide of [false,true]) {
  const fixture=resourceMetadata(themeEntries(),{wide,precedingRows:2});
  assert.deepEqual(readManagedResources(fixture.streams,fixture.resources).map(r=>r.name),themeEntries().map(r=>r.name));
  assert.doesNotThrow(()=>auditManagedResources(fixture.streams,fixture.resources,'Graphics.Core.abc.wasm',standardCss));
  assert.deepEqual(auditWasm(resourceAssembly(fixture),'Graphics.Core.abc.wasm',{publicTheme:standardCss}),{managed:true});
  assert.throws(()=>auditWasm(resourceAssembly(fixture),'Editor.Client.abc.wasm',{publicTheme:standardCss}),/Unapproved managed resource/);
 }
});

test('reviewed current shape definitions pass the same binary and package resource audit', t => {
  for (const wide of [false, true]) {
    const metadata = resourceMetadata([...themeEntries(), ...shapeEntries()], { wide, precedingRows: 2 });
    assert.doesNotThrow(() => auditManagedResources(metadata.streams, metadata.resources, 'Graphics.Core.abc.wasm', standardCss));
    const filename = 'generated/editor/_framework/Graphics.Core.abc.wasm', theme = 'generated/editor/static/themes.css';
    const assembly = resourceAssembly(metadata);
    assert.deepEqual(auditWasm(assembly, filename, { publicTheme: standardCss }), { managed: true });
    const root = fixture(t, { [filename]: assembly, [theme]: standardCss });
    assert.equal(auditPackageFiles(root, [filename, theme]).managedAssemblies, 1);
  }
});

test('shape resource approval rejects changed bytes, renamed definitions and unknown shapes', () => {
  for (let index = 0; index < 3; index++) {
    for (const mutate of [
      entry => entry.data = Buffer.concat([entry.data, Buffer.from(' ')]),
      entry => entry.name = entry.name.replace('.v2.json', '.v1.json'),
      entry => entry.name = 'Graphics.Core.Shapes.Resources.unknown.v2.json',
      entry => entry.name = 'Graphics.Core.Source.cs',
    ]) {
      const shapes = shapeEntries();
      mutate(shapes[index]);
      const { streams, resources } = resourceMetadata([...themeEntries(), ...shapes]);
      assert.throws(() => auditManagedResources(streams, resources, 'Graphics.Core.wasm', standardCss), /Unreviewed|Unapproved/);
    }
  }
});

test('shape catalog approval requires every current definition and the shipped theme', () => {
  const entries = [themeEntries()[1], ...shapeEntries()];
  for (let index = 0; index < entries.length; index++) {
    const { streams, resources } = resourceMetadata(entries.filter((_, position) => position !== index));
    assert.throws(() => auditManagedResources(streams, resources, 'Graphics.Core.wasm', standardCss), /Incomplete/);
  }
  const { streams, resources } = resourceMetadata(shapeEntries().slice(0, 2));
  assert.throws(() => auditManagedResources(streams, resources, 'Graphics.Core.wasm', standardCss), /Incomplete/);
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

test('reviewed shape fixture bytes survive a Windows-style Git checkout',t=>{
 const entries=shapeEntries();
 const files={'.gitattributes':readFileSync(new URL('../.gitattributes',import.meta.url))};
 for(const entry of entries) files['test/fixtures/shapes/'+entry.name.split('.Resources.')[1]]=entry.data;
 const root=fixture(t,files);
 const git=args=>execFileSync('git',['-c','core.autocrlf=true',...args],{cwd:root,stdio:'pipe'});
 git(['init','--quiet']);git(['add','--','.gitattributes','test/fixtures/shapes']);
 for(const file of Object.keys(files).filter(file=>file.endsWith('.json'))) rmSync(path.join(root,file));
 git(['checkout-index','--all','--force']);
 for(const file of Object.keys(files).filter(file=>file.endsWith('.json')))
  assert.deepEqual(readFileSync(path.join(root,file)),files[file],file);
 const fixtureBytes=resourceMetadata([...themeEntries(),...entries.map(entry=>({
  ...entry,data:readFileSync(path.join(root,'test/fixtures/shapes',entry.name.split('.Resources.')[1])),
 }))]);
 assert.deepEqual(auditWasm(resourceAssembly(fixtureBytes),'Graphics.Core.wasm',{publicTheme:standardCss}),{managed:true});
});

test('reviewed current shape data passes the same complete WASM resource audit as themes',()=>{
 for(const wide of [false,true]) {
  const entries=[...shapeEntries(),...themeEntries()];
  const fixture=resourceMetadata(entries,{wide,precedingRows:2});
  assert.deepEqual(auditWasm(resourceAssembly(fixture),'Graphics.Core.abc.wasm',{publicTheme:standardCss}),{managed:true});
 }
});

test('shape resource approval rejects changed data, unknown names, aliases and non-owned assemblies',()=>{
 for(let index=0;index<3;index++) {
  for(const mutate of [
   entry=>entry.data=Buffer.concat([entry.data,Buffer.from(' ')]),
   entry=>entry.name=entry.name.replace('.v2.json','.v3.json'),
   entry=>entry.name='Graphics.Core.Shapes.Resources.Source.cs',
   entry=>entry.name=shapeEntries()[(index+1)%3].name,
  ]) {
   const entries=[...themeEntries(),...shapeEntries()];mutate(entries[index+2]);
   const fixture=resourceMetadata(entries);
   assert.throws(()=>auditWasm(resourceAssembly(fixture),'Graphics.Core.wasm',{publicTheme:standardCss}),/resource|Resource/);
  }
 }
 const fixture=resourceMetadata([...themeEntries(),...shapeEntries()]);
 assert.throws(()=>auditWasm(resourceAssembly(fixture),'Editor.Client.wasm',{publicTheme:standardCss}),/Unapproved managed resource/);
 assert.throws(()=>auditManagedResources(fixture.streams,Buffer.concat([fixture.resources,Buffer.from('hidden source')]),
  'Graphics.Core.wasm',standardCss),/unaccounted/);
 const missingTheme=resourceMetadata([themeEntries()[0],...shapeEntries()]);
 assert.throws(()=>auditManagedResources(missingTheme.streams,missingTheme.resources,'Graphics.Core.wasm',standardCss),/Incomplete/);
 for(let index=0;index<3;index++) {
  const entries=[...themeEntries(),...shapeEntries()];entries.splice(index+2,1);
  const missing=resourceMetadata(entries);
  assert.throws(()=>auditManagedResources(missing.streams,missing.resources,'Graphics.Core.wasm',standardCss),/Incomplete/);
 }
});

test('resource approval rejects superseded styling defaults',()=>{
 const withoutShapeDefaults=groupCss.toString().replace(/^    --shape-[^\n]+\n/gm,'');
 const withoutEmojiDefaults=withoutShapeDefaults.replace('Noto Color Emoji','Missing Emoji');
 const withoutLineLabelDefaults=withoutEmojiDefaults.replace(/^    --line-label-background-[^\n]+\n/gm,'');
 for(const css of [withoutShapeDefaults,withoutEmojiDefaults,withoutLineLabelDefaults]) {
  const entries=themeEntries();entries[0].data=Buffer.from(css);
  const fixture=resourceMetadata(entries);
  assert.throws(()=>auditManagedResources(fixture.streams,fixture.resources,'Graphics.Core.wasm',standardCss),/Unreviewed/);
 }
});

test('automatic shape resource approval accepts only the reviewed radius and shadow defaults',()=>{
 const fixture=resourceMetadata(themeEntries());
 assert.doesNotThrow(()=>auditManagedResources(fixture.streams,fixture.resources,'Graphics.Core.wasm',standardCss));
 for(const replacement of ['--shape-corner-radius: 11px;', '--shape-shadow-sigma: 1;', '--shape-shadow-offset-y: 1;', '--shape-shadow-opacity: 0.1;']) {
  const entries=themeEntries();
  const property=replacement.split(':')[0];
  const current=new RegExp(property+': [^;]+;');
  assert.match(entries[0].data.toString(),current);
  entries[0].data=Buffer.from(entries[0].data.toString().replace(current,replacement));
  const changed=resourceMetadata(entries);
  assert.throws(()=>auditManagedResources(changed.streams,changed.resources,'Graphics.Core.wasm',standardCss),/Unreviewed/);
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
  symlinkSync(path.join(root, "src"), path.join(root, "alias"), "junction");
  assert.throws(() => auditPackageFiles(root, ["alias/index.js"]), /regular local files/);
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

test('a unified theme resource passes only when it matches the shipped public theme', t => {
  const filename = 'generated/editor/_framework/Graphics.Core.current.wasm', theme = 'generated/editor/static/themes.css';
  const entries = [themeEntries()[1], ...shapeEntries()];
  const root = fixture(t, { [filename]: resourceAssembly(resourceMetadata(entries)), [theme]: standardCss });
  assert.deepEqual(auditPackageFiles(root, [filename, theme]), { files: 2, wasmFiles: 1, managedAssemblies: 1 });
  writeFileSync(path.join(root, theme), Buffer.from('different public theme'));
  assert.throws(() => auditPackageFiles(root, [filename, theme]), /differs from the shipped public theme/);
  writeFileSync(path.join(root, filename), resourceAssembly(resourceMetadata(shapeEntries())));
  assert.throws(() => auditPackageFiles(root, [filename, theme]), /Incomplete or unaccounted managed resources/);
});

test('a unified theme requires its shape catalog while retained dual-resource builds remain auditable', () => {
  const retained = resourceMetadata(themeEntries());
  assert.doesNotThrow(() => auditManagedResources(retained.streams, retained.resources, 'Graphics.Core.wasm', standardCss));
  const unified = resourceMetadata([themeEntries()[1]]);
  assert.throws(() => auditManagedResources(unified.streams, unified.resources, 'Graphics.Core.wasm', standardCss), /Incomplete/);
});

test('current shape defaults pass the package audit only with their exact reviewed bytes', t => {
  const filename = 'generated/editor/_framework/Graphics.Core.current.wasm', theme = 'generated/editor/static/themes.css';
  const reviewed = readFileSync(new URL('./fixtures/GroupThemeDefaults-shape-defaults.css', import.meta.url));
  const entries = themeEntries(); entries[0].data = reviewed;
  const root = fixture(t, { [filename]: resourceAssembly(resourceMetadata(entries)), [theme]: standardCss });
  assert.deepEqual(auditPackageFiles(root, [filename, theme]), { files: 2, wasmFiles: 1, managedAssemblies: 1 });
  for (const [before, after] of [
    ['--shape-corner-radius: 10px', '--shape-corner-radius: 11px'],
    ['--shape-shadow-sigma: 0', '--shape-shadow-sigma: 1'],
    ['--shape-shadow-offset-y: 0', '--shape-shadow-offset-y: 1'],
    ['--shape-shadow-opacity: 0', '--shape-shadow-opacity: 1'],
    ['}', '} /* unreviewed content */'],
  ]) {
    entries[0].data = Buffer.from(reviewed.toString('utf8').replace(before, after));
    writeFileSync(path.join(root, filename), resourceAssembly(resourceMetadata(entries)));
    assert.throws(() => auditPackageFiles(root, [filename, theme]), /Unreviewed GroupThemeDefaults.css/);
  }
});
