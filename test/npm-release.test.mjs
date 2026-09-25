import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {releasePolicy,assertReleaseRef,verifyArtifact,registryState,publishArtifact} from "../scripts/npm-release.mjs";

const release={name:"@drawmotive/editor",version:"0.2.0",tag:"latest",gitTag:"editor-v0.2.0",filename:"drawmotive-editor-0.2.0.tgz",integrity:"sha512-example"};
const commit="a".repeat(40);
const state=(published, tags={}, exists=true)=>({published,exists,tags,tagged:published});
const alpha={...release,version:"0.2.2-alpha.1",tag:"alpha",gitTag:"editor-v0.2.2-alpha.1",filename:"drawmotive-editor-0.2.2-alpha.1.tgz"};
test("release policy binds exact stable and alpha versions to explicit npm channels",()=>{
 for(const [version,channel,tag] of [["0.2.2","stable","latest"],["0.2.2-alpha.1","alpha","alpha"]]) {
  const pkg={name:release.name,version,publishConfig:{access:"public",registry:"https://registry.npmjs.org/",tag}};
  const target={version,releaseVersion:version,channel};
  const identity=releasePolicy(pkg,target);
  assert.equal(identity.tag,tag);assert.equal(identity.gitTag,`editor-v${version}`);
  assert.throws(()=>releasePolicy(pkg,{...target,channel:channel==="alpha"?"stable":"alpha"}),/channel.version/);
  assert.throws(()=>releasePolicy(pkg,{...target,version:"0.2.1"}),/release target/);
  assert.throws(()=>releasePolicy(pkg,{...target,releaseVersion:"0.2.1"}),/Coordinated/);
  assert.throws(()=>releasePolicy({...pkg,publishConfig:{...pkg.publishConfig,tag:tag==="alpha"?"latest":"alpha"}},target));
 }
 for(const version of ["0.2.2-beta.1","0.2.2-alpha.01","0.2.2+build","v0.2.2"]) {
  assert.throws(()=>releasePolicy({name:release.name,version},{version,releaseVersion:version,channel:"alpha"}),/stable or alpha/);
 }
});
test("release identity binds branch dispatch, requested version and immutable Actions commit",()=>{
 const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"drawmotive/drawmotive",GITHUB_REF:"refs/heads/release/0.2.0",GITHUB_SHA:commit,GITHUB_EVENT_NAME:"workflow_dispatch",RELEASE_VERSION:"0.2.0"};
 assert.doesNotThrow(()=>assertReleaseRef(release,commit,env));
 assert.doesNotThrow(()=>assertReleaseRef(release,commit,{...env,GITHUB_REF:"refs/tags/editor-v0.2.0"}));
 for(const override of [{GITHUB_ACTIONS:"false"},{GITHUB_REF:"refs/tags/editor-v0.1.0"},{GITHUB_EVENT_NAME:"push"},{RELEASE_VERSION:"0.2.1"},{GITHUB_REPOSITORY:"other/repo"},{GITHUB_SHA:"b".repeat(40)}])assert.throws(()=>assertReleaseRef(release,commit,{...env,...override}));
});
test("artifact receipt rejects tampered bytes and a different producer commit",async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),"editor-release-"));t.after(()=>rm(dir,{recursive:true,force:true}));
 const bytes=Buffer.from("verified archive");
 const receipt={...release,commit,integrity:"sha512-"+createHash("sha512").update(bytes).digest("base64")};
 await writeFile(path.join(dir,release.filename),bytes);await writeFile(path.join(dir,"npm-release.json"),JSON.stringify(receipt));
 assert.deepEqual(await verifyArtifact(dir,release,commit),receipt);
 await assert.rejects(verifyArtifact(dir,release,"b".repeat(40)),/commit mismatch/);
 await writeFile(path.join(dir,release.filename),"different");
 await assert.rejects(verifyArtifact(dir,release,commit),/integrity mismatch/);
});
test("registry verification reads the exact version and rejects conflicting immutable bytes",async()=>{
 const requests=[];
 const fetch=async url=>{requests.push(url);return Response.json(url.endsWith("dist-tags")?{latest:"0.2.0"}:{name:release.name,version:release.version,dist:{integrity:release.integrity}});};
 assert.deepEqual(await registryState(release,fetch),state(true,{latest:"0.2.0"}));
 assert.match(requests[0],/0[.]2[.]0$/);
 await assert.rejects(registryState(release,async()=>Response.json({name:release.name,version:release.version,dist:{integrity:"wrong"}})),/integrity mismatch/);
 assert.deepEqual(await registryState(release,async()=>new Response(null,{status:404})),{published:false,exists:false,tags:{}});
 const unpublished=await registryState(alpha,async url=>url.endsWith("dist-tags")?Response.json({latest:"0.2.1",alpha:"0.2.2-alpha.2"}):new Response(null,{status:404}));
 assert.deepEqual(unpublished,{published:false,exists:true,tagged:false,tags:{latest:"0.2.1",alpha:"0.2.2-alpha.2"}});
 await assert.rejects(registryState(alpha,async url=>new Response(null,{status:url.endsWith("dist-tags")?503:404})),/dist-tags returned HTTP 503/);
});
test("publication sends the exact retained artifact once and waits for registry visibility",async()=>{
 let reads=0;const calls=[];
 const status=await publishArtifact(release,"/release",{run:async args=>calls.push(args),readState:async()=>++reads<3?state(false):state(true,{latest:release.version}),delay:async()=>{}});
 assert.equal(status,"published");assert.equal(calls.length,1);
 assert.equal(calls[0][1],path.join("/release",release.filename));assert.ok(calls[0].includes("--provenance"));
});
test("retry accepts matching published artifacts without another registry write",async()=>{
 const run=async()=>assert.fail("must not republish");
 assert.equal(await publishArtifact(release,"/release",{run,readState:async()=>state(true,{latest:release.version})}),"already-published");
 await assert.rejects(publishArtifact(release,"/release",{run,readState:async()=>({...state(true),tagged:false})}),/different dist-tag/);
});
test("alpha publication uses alpha explicitly and preserves the previous stable default",async()=>{
 let reads=0;const calls=[];
 const status=await publishArtifact(alpha,"/release",{
  run:async args=>calls.push(args),delay:async()=>{},
  readState:async()=>++reads===1?state(false,{latest:"0.2.1"}):state(true,{latest:"0.2.1",alpha:alpha.version}),
 });
 assert.equal(status,"published");assert.equal(calls.length,1);
 assert.equal(calls[0][calls[0].indexOf("--tag")+1],"alpha");
});
test("rollback is rejected before publishing, using semantic alpha sequence ordering",async()=>{
 const run=async()=>assert.fail("must not publish older release");
 for(const tags of [{latest:"0.2.1",alpha:"0.2.2-alpha.2"},{latest:"0.2.2"},{latest:"0.3.0"}]) {
  await assert.rejects(publishArtifact(alpha,"/release",{run,readState:async()=>state(false,tags)}),/Refusing an older/);
 }
 await assert.rejects(publishArtifact(release,"/release",{run,readState:async()=>state(false,{latest:"0.2.1"})}),/older latest/);
 const newer={...alpha,version:"0.2.2-alpha.10"};let reads=0;
 assert.equal(await publishArtifact(newer,"/release",{run:async()=>{},delay:async()=>{},readState:async()=>++reads===1?state(false,{latest:"0.2.1",alpha:"0.2.2-alpha.9"}):state(true,{latest:"0.2.1",alpha:newer.version})}),"published");
});
test("stable graduation replaces the stable default after an alpha on the same version",async()=>{
 const stable={...release,version:"0.2.2"};let reads=0;
 assert.equal(await publishArtifact(stable,"/release",{run:async()=>{},delay:async()=>{},readState:async()=>++reads===1?state(false,{latest:"0.2.2-alpha.1",alpha:"0.2.2-alpha.1"}):state(true,{latest:stable.version,alpha:"0.2.2-alpha.1"})}),"published");
});
test("alpha publication fails immediately when an existing latest changes, including before version visibility",async()=>{
 for(const published of [false,true]) {
  let reads=0;
  await assert.rejects(publishArtifact(alpha,"/release",{run:async()=>{},delay:async()=>assert.fail("unsafe state must not retry"),readState:async()=>++reads===1?state(false,{latest:"0.2.1"}):state(published,{latest:alpha.version,alpha:alpha.version})}),/changed an existing latest/);
  assert.equal(reads,2);
 }
});
test("a first publication may acquire latest, while an existing package without latest stays unchanged",async()=>{
 for(const exists of [false,true]) {
  let reads=0;
  const result=publishArtifact(alpha,"/release",{run:async()=>{},delay:async()=>{},readState:async()=>++reads===1?state(false,{},exists):state(true,{latest:alpha.version,alpha:alpha.version})});
  if(exists) await assert.rejects(result,/changed an existing latest/);
  else assert.equal(await result,"published");
 }
});
