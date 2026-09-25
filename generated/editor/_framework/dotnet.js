//! Licensed to the .NET Foundation under one or more agreements.
//! The .NET Foundation licenses this file to you under the MIT license.

var e=!1;const t=async()=>WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,8,1,6,0,6,64,25,11,11])),o=async()=>WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11])),n=async()=>WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])),r=Symbol.for("wasm promise_control");function i(e,t){let o=null;const n=new Promise((function(n,r){o={isDone:!1,promise:null,resolve:t=>{o.isDone||(o.isDone=!0,n(t),e&&e())},reject:e=>{o.isDone||(o.isDone=!0,r(e),t&&t())}}}));o.promise=n;const i=n;return i[r]=o,{promise:i,promise_control:o}}function s(e){return e[r]}function a(e){e&&function(e){return void 0!==e[r]}(e)||Be(!1,"Promise is not controllable")}const l="__mono_message__",c=["debug","log","trace","warn","info","error"],d="MONO_WASM: ";let u,f,m,g,p,h;function w(e){g=e}function b(e){if(Pe.diagnosticTracing){const t="function"==typeof e?e():e;console.debug(d+t)}}function y(e,...t){console.info(d+e,...t)}function v(e,...t){console.info(e,...t)}function E(e,...t){console.warn(d+e,...t)}function _(e,...t){if(t&&t.length>0&&t[0]&&"object"==typeof t[0]){if(t[0].silent)return;if(t[0].toString)return void console.error(d+e,t[0].toString())}console.error(d+e,...t)}function x(e,t,o){return function(...n){try{let r=n[0];if(void 0===r)r="undefined";else if(null===r)r="null";else if("function"==typeof r)r=r.toString();else if("string"!=typeof r)try{r=JSON.stringify(r)}catch(e){r=r.toString()}t(o?JSON.stringify({method:e,payload:r,arguments:n.slice(1)}):[e+r,...n.slice(1)])}catch(e){m.error(`proxyConsole failed: ${e}`)}}}function j(e,t,o){f=t,g=e,m={...t};const n=`${o}/console`.replace("https://","wss://").replace("http://","ws://");u=new WebSocket(n),u.addEventListener("error",A),u.addEventListener("close",S),function(){for(const e of c)f[e]=x(`console.${e}`,T,!0)}()}function R(e){let t=30;const o=()=>{u?0==u.bufferedAmount||0==t?(e&&v(e),function(){for(const e of c)f[e]=x(`console.${e}`,m.log,!1)}(),u.removeEventListener("error",A),u.removeEventListener("close",S),u.close(1e3,e),u=void 0):(t--,globalThis.setTimeout(o,100)):e&&m&&m.log(e)};o()}function T(e){u&&u.readyState===WebSocket.OPEN?u.send(e):m.log(e)}function A(e){m.error(`[${g}] proxy console websocket error: ${e}`,e)}function S(e){m.debug(`[${g}] proxy console websocket closed: ${e}`,e)}function D(){Pe.preferredIcuAsset=O(Pe.config);let e="invariant"==Pe.config.globalizationMode;if(!e)if(Pe.preferredIcuAsset)Pe.diagnosticTracing&&b("ICU data archive(s) available, disabling invariant mode");else{if("custom"===Pe.config.globalizationMode||"all"===Pe.config.globalizationMode||"sharded"===Pe.config.globalizationMode){const e="invariant globalization mode is inactive and no ICU data archives are available";throw _(`ERROR: ${e}`),new Error(e)}Pe.diagnosticTracing&&b("ICU data archive(s) not available, using invariant globalization mode"),e=!0,Pe.preferredIcuAsset=null}const t="DOTNET_SYSTEM_GLOBALIZATION_INVARIANT",o=Pe.config.environmentVariables;if(void 0===o[t]&&e&&(o[t]="1"),void 0===o.TZ)try{const e=Intl.DateTimeFormat().resolvedOptions().timeZone||null;e&&(o.TZ=e)}catch(e){y("failed to detect timezone, will fallback to UTC")}}function O(e){var t;if((null===(t=e.resources)||void 0===t?void 0:t.icu)&&"invariant"!=e.globalizationMode){const t=e.applicationCulture||(ke?globalThis.navigator&&globalThis.navigator.languages&&globalThis.navigator.languages[0]:Intl.DateTimeFormat().resolvedOptions().locale),o=e.resources.icu;let n=null;if("custom"===e.globalizationMode){if(o.length>=1)return o[0].name}else t&&"all"!==e.globalizationMode?"sharded"===e.globalizationMode&&(n=function(e){const t=e.split("-")[0];return"en"===t||["fr","fr-FR","it","it-IT","de","de-DE","es","es-ES"].includes(e)?"icudt_EFIGS.dat":["zh","ko","ja"].includes(t)?"icudt_CJK.dat":"icudt_no_CJK.dat"}(t)):n="icudt.dat";if(n)for(let e=0;e<o.length;e++){const t=o[e];if(t.virtualPath===n)return t.name}}return e.globalizationMode="invariant",null}(new Date).valueOf();const C=class{constructor(e){this.url=e}toString(){return this.url}};async function k(e,t){try{const o="function"==typeof globalThis.fetch;if(Se){const n=e.startsWith("file://");if(!n&&o)return globalThis.fetch(e,t||{credentials:"same-origin"});p||(h=Ne.require("url"),p=Ne.require("fs")),n&&(e=h.fileURLToPath(e));const r=await p.promises.readFile(e);return{ok:!0,headers:{length:0,get:()=>null},url:e,arrayBuffer:()=>r,json:()=>JSON.parse(r),text:()=>{throw new Error("NotImplementedException")}}}if(o)return globalThis.fetch(e,t||{credentials:"same-origin"});if("function"==typeof read)return{ok:!0,url:e,headers:{length:0,get:()=>null},arrayBuffer:()=>new Uint8Array(read(e,"binary")),json:()=>JSON.parse(read(e,"utf8")),text:()=>read(e,"utf8")}}catch(t){return{ok:!1,url:e,status:500,headers:{length:0,get:()=>null},statusText:"ERR28: "+t,arrayBuffer:()=>{throw t},json:()=>{throw t},text:()=>{throw t}}}throw new Error("No fetch implementation available")}function I(e){return"string"!=typeof e&&Be(!1,"url must be a string"),!M(e)&&0!==e.indexOf("./")&&0!==e.indexOf("../")&&globalThis.URL&&globalThis.document&&globalThis.document.baseURI&&(e=new URL(e,globalThis.document.baseURI).toString()),e}const U=/^[a-zA-Z][a-zA-Z\d+\-.]*?:\/\//,P=/[a-zA-Z]:[\\/]/;function M(e){return Se||Ie?e.startsWith("/")||e.startsWith("\\")||-1!==e.indexOf("///")||P.test(e):U.test(e)}let L,N=0;const $=[],z=[],W=new Map,F={"js-module-threads":!0,"js-module-runtime":!0,"js-module-dotnet":!0,"js-module-native":!0,"js-module-diagnostics":!0},B={...F,"js-module-library-initializer":!0},V={...F,dotnetwasm:!0,heap:!0,manifest:!0},q={...B,manifest:!0},H={...B,dotnetwasm:!0},J={dotnetwasm:!0,symbols:!0},Z={...B,dotnetwasm:!0,symbols:!0},Q={symbols:!0};function G(e){return!("icu"==e.behavior&&e.name!=Pe.preferredIcuAsset)}function K(e,t,o){null!=t||(t=[]),Be(1==t.length,`Expect to have one ${o} asset in resources`);const n=t[0];return n.behavior=o,X(n),e.push(n),n}function X(e){V[e.behavior]&&W.set(e.behavior,e)}function Y(e){Be(V[e],`Unknown single asset behavior ${e}`);const t=W.get(e);if(t&&!t.resolvedUrl)if(t.resolvedUrl=Pe.locateFile(t.name),F[t.behavior]){const e=ge(t);e?("string"!=typeof e&&Be(!1,"loadBootResource response for 'dotnetjs' type should be a URL string"),t.resolvedUrl=e):t.resolvedUrl=ce(t.resolvedUrl,t.behavior)}else if("dotnetwasm"!==t.behavior)throw new Error(`Unknown single asset behavior ${e}`);return t}function ee(e){const t=Y(e);return Be(t,`Single asset for ${e} not found`),t}let te=!1;async function oe(){if(!te){te=!0,Pe.diagnosticTracing&&b("mono_download_assets");try{const e=[],t=[],o=(e,t)=>{!Z[e.behavior]&&G(e)&&Pe.expected_instantiated_assets_count++,!H[e.behavior]&&G(e)&&(Pe.expected_downloaded_assets_count++,t.push(se(e)))};for(const t of $)o(t,e);for(const e of z)o(e,t);Pe.allDownloadsQueued.promise_control.resolve(),Promise.all([...e,...t]).then((()=>{Pe.allDownloadsFinished.promise_control.resolve()})).catch((e=>{throw Pe.err("Error in mono_download_assets: "+e),Xe(1,e),e})),await Pe.runtimeModuleLoaded.promise;const n=async e=>{const t=await e;if(t.buffer){if(!Z[t.behavior]){t.buffer&&"object"==typeof t.buffer||Be(!1,"asset buffer must be array-like or buffer-like or promise of these"),"string"!=typeof t.resolvedUrl&&Be(!1,"resolvedUrl must be string");const e=t.resolvedUrl,o=await t.buffer,n=new Uint8Array(o);pe(t),await Ue.beforeOnRuntimeInitialized.promise,Ue.instantiate_asset(t,e,n)}}else J[t.behavior]?("symbols"===t.behavior&&(await Ue.instantiate_symbols_asset(t),pe(t)),J[t.behavior]&&++Pe.actual_downloaded_assets_count):(t.isOptional||Be(!1,"Expected asset to have the downloaded buffer"),!H[t.behavior]&&G(t)&&Pe.expected_downloaded_assets_count--,!Z[t.behavior]&&G(t)&&Pe.expected_instantiated_assets_count--)},r=[],i=[];for(const t of e)r.push(n(t));for(const e of t)i.push(n(e));Promise.all(r).then((()=>{Ce||Ue.coreAssetsInMemory.promise_control.resolve()})).catch((e=>{throw Pe.err("Error in mono_download_assets: "+e),Xe(1,e),e})),Promise.all(i).then((async()=>{Ce||(await Ue.coreAssetsInMemory.promise,Ue.allAssetsInMemory.promise_control.resolve())})).catch((e=>{throw Pe.err("Error in mono_download_assets: "+e),Xe(1,e),e}))}catch(e){throw Pe.err("Error in mono_download_assets: "+e),e}}}let ne=!1;function re(){if(ne)return;ne=!0;const e=Pe.config,t=[];if(e.assets)for(const t of e.assets)"object"!=typeof t&&Be(!1,`asset must be object, it was ${typeof t} : ${t}`),"string"!=typeof t.behavior&&Be(!1,"asset behavior must be known string"),"string"!=typeof t.name&&Be(!1,"asset name must be string"),t.resolvedUrl&&"string"!=typeof t.resolvedUrl&&Be(!1,"asset resolvedUrl could be string"),t.hash&&"string"!=typeof t.hash&&Be(!1,"asset resolvedUrl could be string"),t.pendingDownload&&"object"!=typeof t.pendingDownload&&Be(!1,"asset pendingDownload could be object"),t.isCore?$.push(t):z.push(t),X(t);else if(e.resources){const o=e.resources;o.wasmNative||Be(!1,"resources.wasmNative must be defined"),o.jsModuleNative||Be(!1,"resources.jsModuleNative must be defined"),o.jsModuleRuntime||Be(!1,"resources.jsModuleRuntime must be defined"),K(z,o.wasmNative,"dotnetwasm"),K(t,o.jsModuleNative,"js-module-native"),K(t,o.jsModuleRuntime,"js-module-runtime"),o.jsModuleDiagnostics&&K(t,o.jsModuleDiagnostics,"js-module-diagnostics");const n=(e,t,o)=>{const n=e;n.behavior=t,o?(n.isCore=!0,$.push(n)):z.push(n)};if(o.coreAssembly)for(let e=0;e<o.coreAssembly.length;e++)n(o.coreAssembly[e],"assembly",!0);if(o.assembly)for(let e=0;e<o.assembly.length;e++)n(o.assembly[e],"assembly",!o.coreAssembly);if(0!=e.debugLevel&&Pe.isDebuggingSupported()){if(o.corePdb)for(let e=0;e<o.corePdb.length;e++)n(o.corePdb[e],"pdb",!0);if(o.pdb)for(let e=0;e<o.pdb.length;e++)n(o.pdb[e],"pdb",!o.corePdb)}if(e.loadAllSatelliteResources&&o.satelliteResources)for(const e in o.satelliteResources)for(let t=0;t<o.satelliteResources[e].length;t++){const r=o.satelliteResources[e][t];r.culture=e,n(r,"resource",!o.coreAssembly)}if(o.coreVfs)for(let e=0;e<o.coreVfs.length;e++)n(o.coreVfs[e],"vfs",!0);if(o.vfs)for(let e=0;e<o.vfs.length;e++)n(o.vfs[e],"vfs",!o.coreVfs);const r=O(e);if(r&&o.icu)for(let e=0;e<o.icu.length;e++){const t=o.icu[e];t.name===r&&n(t,"icu",!1)}if(o.wasmSymbols)for(let e=0;e<o.wasmSymbols.length;e++)n(o.wasmSymbols[e],"symbols",!1)}if(e.appsettings)for(let t=0;t<e.appsettings.length;t++){const o=e.appsettings[t],n=he(o);"appsettings.json"!==n&&n!==`appsettings.${e.applicationEnvironment}.json`||z.push({name:o,behavior:"vfs",cache:"no-cache",useCredentials:!0})}e.assets=[...$,...z,...t]}async function ie(e){const t=await se(e);return await t.pendingDownloadInternal.response,t.buffer}async function se(e){try{return await ae(e)}catch(t){if(!Pe.enableDownloadRetry)throw t;if(Ie||Se)throw t;if(e.pendingDownload&&e.pendingDownloadInternal==e.pendingDownload)throw t;if(e.resolvedUrl&&-1!=e.resolvedUrl.indexOf("file://"))throw t;if(t&&404==t.status)throw t;e.pendingDownloadInternal=void 0,await Pe.allDownloadsQueued.promise;try{return Pe.diagnosticTracing&&b(`Retrying download '${e.name}'`),await ae(e)}catch(t){return e.pendingDownloadInternal=void 0,await new Promise((e=>globalThis.setTimeout(e,100))),Pe.diagnosticTracing&&b(`Retrying download (2) '${e.name}' after delay`),await ae(e)}}}async function ae(e){for(;L;)await L.promise;try{++N,N==Pe.maxParallelDownloads&&(Pe.diagnosticTracing&&b("Throttling further parallel downloads"),L=i());const t=await async function(e){if(e.pendingDownload&&(e.pendingDownloadInternal=e.pendingDownload),e.pendingDownloadInternal&&e.pendingDownloadInternal.response)return e.pendingDownloadInternal.response;if(e.buffer){const t=await e.buffer;return e.resolvedUrl||(e.resolvedUrl="undefined://"+e.name),e.pendingDownloadInternal={url:e.resolvedUrl,name:e.name,response:Promise.resolve({ok:!0,arrayBuffer:()=>t,json:()=>JSON.parse(new TextDecoder("utf-8").decode(t)),text:()=>{throw new Error("NotImplementedException")},headers:{get:()=>{}}})},e.pendingDownloadInternal.response}const t=e.loadRemote&&Pe.config.remoteSources?Pe.config.remoteSources:[""];let o;for(let n of t){n=n.trim(),"./"===n&&(n="");const t=le(e,n);e.name===t?Pe.diagnosticTracing&&b(`Attempting to download '${t}'`):Pe.diagnosticTracing&&b(`Attempting to download '${t}' for ${e.name}`);try{e.resolvedUrl=t;const n=fe(e);if(e.pendingDownloadInternal=n,o=await n.response,!o||!o.ok)continue;return o}catch(e){o||(o={ok:!1,url:t,status:0,statusText:""+e});continue}}const n=e.isOptional||e.name.match(/\.pdb$/)&&Pe.config.ignorePdbLoadErrors;if(o||Be(!1,`Response undefined ${e.name}`),!n){const t=new Error(`download '${o.url}' for ${e.name} failed ${o.status} ${o.statusText}`);throw t.status=o.status,t}y(`optional download '${o.url}' for ${e.name} failed ${o.status} ${o.statusText}`)}(e);return t?(J[e.behavior]||(e.buffer=await t.arrayBuffer(),++Pe.actual_downloaded_assets_count),e):e}finally{if(--N,L&&N==Pe.maxParallelDownloads-1){Pe.diagnosticTracing&&b("Resuming more parallel downloads");const e=L;L=void 0,e.promise_control.resolve()}}}function le(e,t){let o;return null==t&&Be(!1,`sourcePrefix must be provided for ${e.name}`),e.resolvedUrl?o=e.resolvedUrl:(o=""===t?"assembly"===e.behavior||"pdb"===e.behavior?e.name:"resource"===e.behavior&&e.culture&&""!==e.culture?`${e.culture}/${e.name}`:e.name:t+e.name,o=ce(Pe.locateFile(o),e.behavior)),o&&"string"==typeof o||Be(!1,"attemptUrl need to be path or url string"),o}function ce(e,t){return Pe.modulesUniqueQuery&&q[t]&&(e+=Pe.modulesUniqueQuery),e}let de=0;const ue=new Set;function fe(e){try{e.resolvedUrl||Be(!1,"Request's resolvedUrl must be set");const t=function(e){let t=e.resolvedUrl;if(Pe.loadBootResource){const o=ge(e);if(o instanceof Promise)return o;"string"==typeof o&&(t=o)}const o={};return e.cache?o.cache=e.cache:Pe.config.disableNoCacheFetch||(o.cache="no-cache"),e.useCredentials?o.credentials="include":!Pe.config.disableIntegrityCheck&&e.hash&&(o.integrity=e.hash),Pe.fetch_like(t,o)}(e),o={name:e.name,url:e.resolvedUrl,response:t};return ue.add(e.name),o.response.then((()=>{"assembly"==e.behavior&&Pe.loadedAssemblies.push(e.name),de++,Pe.onDownloadResourceProgress&&Pe.onDownloadResourceProgress(de,ue.size)})),o}catch(t){const o={ok:!1,url:e.resolvedUrl,status:500,statusText:"ERR29: "+t,arrayBuffer:()=>{throw t},json:()=>{throw t}};return{name:e.name,url:e.resolvedUrl,response:Promise.resolve(o)}}}const me={resource:"assembly",assembly:"assembly",pdb:"pdb",icu:"globalization",vfs:"configuration",manifest:"manifest",dotnetwasm:"dotnetwasm","js-module-dotnet":"dotnetjs","js-module-native":"dotnetjs","js-module-runtime":"dotnetjs","js-module-threads":"dotnetjs"};function ge(e){var t;if(Pe.loadBootResource){const o=null!==(t=e.hash)&&void 0!==t?t:"",n=e.resolvedUrl,r=me[e.behavior];if(r){const t=Pe.loadBootResource(r,e.name,n,o,e.behavior);return"string"==typeof t?I(t):t}}}function pe(e){e.pendingDownloadInternal=null,e.pendingDownload=null,e.buffer=null,e.moduleExports=null}function he(e){let t=e.lastIndexOf("/");return t>=0&&t++,e.substring(t)}async function we(e){e&&await Promise.all((null!=e?e:[]).map((e=>async function(e){try{const t=e.name;if(!e.moduleExports){const o=ce(Pe.locateFile(t),"js-module-library-initializer");Pe.diagnosticTracing&&b(`Attempting to import '${o}' for ${e}`),e.moduleExports=await import(/*! webpackIgnore: true */o)}Pe.libraryInitializers.push({scriptName:t,exports:e.moduleExports})}catch(t){E(`Failed to import library initializer '${e}': ${t}`)}}(e))))}async function be(e,t){if(!Pe.libraryInitializers)return;const o=[];for(let n=0;n<Pe.libraryInitializers.length;n++){const r=Pe.libraryInitializers[n];r.exports[e]&&o.push(ye(r.scriptName,e,(()=>r.exports[e](...t))))}await Promise.all(o)}async function ye(e,t,o){try{await o()}catch(o){throw E(`Failed to invoke '${t}' on library initializer '${e}': ${o}`),Xe(1,o),o}}function ve(e,t){if(e===t)return e;const o={...t};return void 0!==o.assets&&o.assets!==e.assets&&(o.assets=[...e.assets||[],...o.assets||[]]),void 0!==o.resources&&(o.resources=_e(e.resources||{assembly:[],jsModuleNative:[],jsModuleRuntime:[],wasmNative:[]},o.resources)),void 0!==o.environmentVariables&&(o.environmentVariables={...e.environmentVariables||{},...o.environmentVariables||{}}),void 0!==o.runtimeOptions&&o.runtimeOptions!==e.runtimeOptions&&(o.runtimeOptions=[...e.runtimeOptions||[],...o.runtimeOptions||[]]),Object.assign(e,o)}function Ee(e,t){if(e===t)return e;const o={...t};return o.config&&(e.config||(e.config={}),o.config=ve(e.config,o.config)),Object.assign(e,o)}function _e(e,t){if(e===t)return e;const o={...t};return void 0!==o.coreAssembly&&(o.coreAssembly=[...e.coreAssembly||[],...o.coreAssembly||[]]),void 0!==o.assembly&&(o.assembly=[...e.assembly||[],...o.assembly||[]]),void 0!==o.lazyAssembly&&(o.lazyAssembly=[...e.lazyAssembly||[],...o.lazyAssembly||[]]),void 0!==o.corePdb&&(o.corePdb=[...e.corePdb||[],...o.corePdb||[]]),void 0!==o.pdb&&(o.pdb=[...e.pdb||[],...o.pdb||[]]),void 0!==o.jsModuleWorker&&(o.jsModuleWorker=[...e.jsModuleWorker||[],...o.jsModuleWorker||[]]),void 0!==o.jsModuleNative&&(o.jsModuleNative=[...e.jsModuleNative||[],...o.jsModuleNative||[]]),void 0!==o.jsModuleDiagnostics&&(o.jsModuleDiagnostics=[...e.jsModuleDiagnostics||[],...o.jsModuleDiagnostics||[]]),void 0!==o.jsModuleRuntime&&(o.jsModuleRuntime=[...e.jsModuleRuntime||[],...o.jsModuleRuntime||[]]),void 0!==o.wasmSymbols&&(o.wasmSymbols=[...e.wasmSymbols||[],...o.wasmSymbols||[]]),void 0!==o.wasmNative&&(o.wasmNative=[...e.wasmNative||[],...o.wasmNative||[]]),void 0!==o.icu&&(o.icu=[...e.icu||[],...o.icu||[]]),void 0!==o.satelliteResources&&(o.satelliteResources=function(e,t){if(e===t)return e;for(const o in t)e[o]=[...e[o]||[],...t[o]||[]];return e}(e.satelliteResources||{},o.satelliteResources||{})),void 0!==o.modulesAfterConfigLoaded&&(o.modulesAfterConfigLoaded=[...e.modulesAfterConfigLoaded||[],...o.modulesAfterConfigLoaded||[]]),void 0!==o.modulesAfterRuntimeReady&&(o.modulesAfterRuntimeReady=[...e.modulesAfterRuntimeReady||[],...o.modulesAfterRuntimeReady||[]]),void 0!==o.extensions&&(o.extensions={...e.extensions||{},...o.extensions||{}}),void 0!==o.vfs&&(o.vfs=[...e.vfs||[],...o.vfs||[]]),Object.assign(e,o)}function xe(){const e=Pe.config;if(e.environmentVariables=e.environmentVariables||{},e.runtimeOptions=e.runtimeOptions||[],e.resources=e.resources||{assembly:[],jsModuleNative:[],jsModuleWorker:[],jsModuleRuntime:[],wasmNative:[],vfs:[],satelliteResources:{}},e.assets){Pe.diagnosticTracing&&b("config.assets is deprecated, use config.resources instead");for(const t of e.assets){const o={};switch(t.behavior){case"assembly":o.assembly=[t];break;case"pdb":o.pdb=[t];break;case"resource":o.satelliteResources={},o.satelliteResources[t.culture]=[t];break;case"icu":o.icu=[t];break;case"symbols":o.wasmSymbols=[t];break;case"vfs":o.vfs=[t];break;case"dotnetwasm":o.wasmNative=[t];break;case"js-module-threads":o.jsModuleWorker=[t];break;case"js-module-runtime":o.jsModuleRuntime=[t];break;case"js-module-native":o.jsModuleNative=[t];break;case"js-module-diagnostics":o.jsModuleDiagnostics=[t];break;case"js-module-dotnet":break;default:throw new Error(`Unexpected behavior ${t.behavior} of asset ${t.name}`)}_e(e.resources,o)}}e.debugLevel,e.applicationEnvironment||(e.applicationEnvironment="Production"),e.applicationCulture&&(e.environmentVariables.LANG=`${e.applicationCulture}.UTF-8`),Ue.diagnosticTracing=Pe.diagnosticTracing=!!e.diagnosticTracing,Ue.waitForDebugger=e.waitForDebugger,Pe.maxParallelDownloads=e.maxParallelDownloads||Pe.maxParallelDownloads,Pe.enableDownloadRetry=void 0!==e.enableDownloadRetry?e.enableDownloadRetry:Pe.enableDownloadRetry}let je=!1;async function Re(e){var t;if(je)return void await Pe.afterConfigLoaded.promise;let o;try{if(e.configSrc||Pe.config&&0!==Object.keys(Pe.config).length&&(Pe.config.assets||Pe.config.resources)||(e.configSrc="dotnet.boot.js"),o=e.configSrc,je=!0,o&&(Pe.diagnosticTracing&&b("mono_wasm_load_config"),await async function(e){const t=e.configSrc,o=Pe.locateFile(t);let n=null;void 0!==Pe.loadBootResource&&(n=Pe.loadBootResource("manifest",t,o,"","manifest"));let r,i=null;if(n)if("string"==typeof n)n.includes(".json")?(i=await s(I(n)),r=await Ae(i)):r=(await import(I(n))).config;else{const e=await n;"function"==typeof e.json?(i=e,r=await Ae(i)):r=e.config}else o.includes(".json")?(i=await s(ce(o,"manifest")),r=await Ae(i)):r=(await import(ce(o,"manifest"))).config;function s(e){return Pe.fetch_like(e,{method:"GET",credentials:"include",cache:"no-cache"})}Pe.config.applicationEnvironment&&(r.applicationEnvironment=Pe.config.applicationEnvironment),ve(Pe.config,r)}(e)),xe(),await we(null===(t=Pe.config.resources)||void 0===t?void 0:t.modulesAfterConfigLoaded),await be("onRuntimeConfigLoaded",[Pe.config]),e.onConfigLoaded)try{await e.onConfigLoaded(Pe.config,Le),xe()}catch(e){throw _("onConfigLoaded() failed",e),e}xe(),Pe.afterConfigLoaded.promise_control.resolve(Pe.config)}catch(t){const n=`Failed to load config file ${o} ${t} ${null==t?void 0:t.stack}`;throw Pe.config=e.config=Object.assign(Pe.config,{message:n,error:t,isError:!0}),Xe(1,new Error(n)),t}}function Te(){return!!globalThis.navigator&&(Pe.isChromium||Pe.isFirefox)}async function Ae(e){const t=Pe.config,o=await e.json();t.applicationEnvironment||o.applicationEnvironment||(o.applicationEnvironment=e.headers.get("Blazor-Environment")||e.headers.get("DotNet-Environment")||void 0),o.environmentVariables||(o.environmentVariables={});const n=e.headers.get("DOTNET-MODIFIABLE-ASSEMBLIES");n&&(o.environmentVariables.DOTNET_MODIFIABLE_ASSEMBLIES=n);const r=e.headers.get("ASPNETCORE-BROWSER-TOOLS");return r&&(o.environmentVariables.__ASPNETCORE_BROWSER_TOOLS=r),o}"function"!=typeof importScripts||globalThis.onmessage||(globalThis.dotnetSidecar=!0);const Se="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node,De="function"==typeof importScripts,Oe=De&&"undefined"!=typeof dotnetSidecar,Ce=De&&!Oe,ke="object"==typeof window||De&&!Se,Ie=!ke&&!Se;let Ue={},Pe={},Me={},Le={},Ne={},$e=!1;const ze={},We={config:ze},Fe={mono:{},binding:{},internal:Ne,module:We,loaderHelpers:Pe,runtimeHelpers:Ue,diagnosticHelpers:Me,api:Le};function Be(e,t){if(e)return;const o="Assert failed: "+("function"==typeof t?t():t),n=new Error(o);_(o,n),Ue.nativeAbort(n)}function Ve(){return void 0!==Pe.exitCode}function qe(){return Ue.runtimeReady&&!Ve()}function He(){Ve()&&Be(!1,`.NET runtime already exited with ${Pe.exitCode} ${Pe.exitReason}. You can use runtime.runMain() which doesn't exit the runtime.`),Ue.runtimeReady||Be(!1,".NET runtime didn't start yet. Please call dotnet.create() first.")}function Je(){ke&&(globalThis.addEventListener("unhandledrejection",et),globalThis.addEventListener("error",tt))}let Ze,Qe;function Ge(e){Qe&&Qe(e),Xe(e,Pe.exitReason)}function Ke(e){Ze&&Ze(e||Pe.exitReason),Xe(1,e||Pe.exitReason)}function Xe(t,o){var n,r;const i=o&&"object"==typeof o;t=i&&"number"==typeof o.status?o.status:void 0===t?-1:t;const s=i&&"string"==typeof o.message?o.message:""+o;(o=i?o:Ue.ExitStatus?function(e,t){const o=new Ue.ExitStatus(e);return o.message=t,o.toString=()=>t,o}(t,s):new Error("Exit with code "+t+" "+s)).status=t,o.message||(o.message=s);const a=""+(o.stack||(new Error).stack);try{Object.defineProperty(o,"stack",{get:()=>a})}catch(e){}const l=!!o.silent;if(o.silent=!0,Ve())Pe.diagnosticTracing&&b("mono_exit called after exit");else{try{We.onAbort==Ke&&(We.onAbort=Ze),We.onExit==Ge&&(We.onExit=Qe),ke&&(globalThis.removeEventListener("unhandledrejection",et),globalThis.removeEventListener("error",tt)),Ue.runtimeReady?(Ue.jiterpreter_dump_stats&&Ue.jiterpreter_dump_stats(!1),0===t&&(null===(n=Pe.config)||void 0===n?void 0:n.interopCleanupOnExit)&&Ue.forceDisposeProxies(!0,!0),e&&0!==t&&(null===(r=Pe.config)||void 0===r||r.dumpThreadsOnNonZeroExit)):(Pe.diagnosticTracing&&b(`abort_startup, reason: ${o}`),function(e){Pe.allDownloadsQueued.promise_control.reject(e),Pe.allDownloadsFinished.promise_control.reject(e),Pe.afterConfigLoaded.promise_control.reject(e),Pe.wasmCompilePromise.promise_control.reject(e),Pe.runtimeModuleLoaded.promise_control.reject(e),Ue.dotnetReady&&(Ue.dotnetReady.promise_control.reject(e),Ue.afterInstantiateWasm.promise_control.reject(e),Ue.beforePreInit.promise_control.reject(e),Ue.afterPreInit.promise_control.reject(e),Ue.afterPreRun.promise_control.reject(e),Ue.beforeOnRuntimeInitialized.promise_control.reject(e),Ue.afterOnRuntimeInitialized.promise_control.reject(e),Ue.afterPostRun.promise_control.reject(e))}(o))}catch(e){E("mono_exit A failed",e)}try{l||(function(e,t){if(0!==e&&t){const e=Ue.ExitStatus&&t instanceof Ue.ExitStatus?b:_;"string"==typeof t?e(t):(void 0===t.stack&&(t.stack=(new Error).stack+""),t.message?e(Ue.stringify_as_error_with_stack?Ue.stringify_as_error_with_stack(t.message+"\n"+t.stack):t.message+"\n"+t.stack):e(JSON.stringify(t)))}!Ce&&Pe.config&&(Pe.config.logExitCode?Pe.config.forwardConsoleLogsToWS?R("WASM EXIT "+e):v("WASM EXIT "+e):Pe.config.forwardConsoleLogsToWS&&R())}(t,o),function(e){if(ke&&!Ce&&Pe.config&&Pe.config.appendElementOnExit&&document){const t=document.createElement("label");t.id="tests_done",0!==e&&(t.style.background="red"),t.innerHTML=""+e,document.body.appendChild(t)}}(t))}catch(e){E("mono_exit B failed",e)}Pe.exitCode=t,Pe.exitReason||(Pe.exitReason=o),!Ce&&Ue.runtimeReady&&We.runtimeKeepalivePop()}if(Pe.config&&Pe.config.asyncFlushOnExit&&0===t)throw(async()=>{try{await async function(){try{const e=await import(/*! webpackIgnore: true */"process"),t=e=>new Promise(((t,o)=>{e.on("error",o),e.end("","utf8",t)})),o=t(e.stderr),n=t(e.stdout);let r;const i=new Promise((e=>{r=setTimeout((()=>e("timeout")),1e3)}));await Promise.race([Promise.all([n,o]),i]),clearTimeout(r)}catch(e){_(`flushing std* streams failed: ${e}`)}}()}finally{Ye(t,o)}})(),o;Ye(t,o)}function Ye(e,t){if(Ue.runtimeReady&&Ue.nativeExit)try{Ue.nativeExit(e)}catch(e){!Ue.ExitStatus||e instanceof Ue.ExitStatus||E("set_exit_code_and_quit_now failed: "+e.toString())}if(0!==e||!ke)throw Se&&Ne.process?Ne.process.exit(e):Ue.quit&&Ue.quit(e,t),t}function et(e){ot(e,e.reason,"rejection")}function tt(e){ot(e,e.error,"error")}function ot(e,t,o){e.preventDefault();try{t||(t=new Error("Unhandled "+o)),void 0===t.stack&&(t.stack=(new Error).stack),t.stack=t.stack+"",t.silent||(_("Unhandled error:",t),Xe(1,t))}catch(e){}}!function(e){if($e)throw new Error("Loader module already loaded");$e=!0,Ue=e.runtimeHelpers,Pe=e.loaderHelpers,Me=e.diagnosticHelpers,Le=e.api,Ne=e.internal,Object.assign(Le,{INTERNAL:Ne,invokeLibraryInitializers:be}),Object.assign(e.module,{config:ve(ze,{environmentVariables:{}})});const r={mono_wasm_bindings_is_ready:!1,config:e.module.config,diagnosticTracing:!1,nativeAbort:e=>{throw e||new Error("abort")},nativeExit:e=>{throw new Error("exit:"+e)}},l={gitHash:"95017c711e6afc1085133d440e42b4bd78155701",config:e.module.config,diagnosticTracing:!1,maxParallelDownloads:16,enableDownloadRetry:!0,_loaded_files:[],loadedFiles:[],loadedAssemblies:[],libraryInitializers:[],workerNextNumber:1,actual_downloaded_assets_count:0,actual_instantiated_assets_count:0,expected_downloaded_assets_count:0,expected_instantiated_assets_count:0,afterConfigLoaded:i(),allDownloadsQueued:i(),allDownloadsFinished:i(),wasmCompilePromise:i(),runtimeModuleLoaded:i(),loadingWorkers:i(),is_exited:Ve,is_runtime_running:qe,assert_runtime_running:He,mono_exit:Xe,createPromiseController:i,getPromiseController:s,assertIsControllablePromise:a,mono_download_assets:oe,resolve_single_asset_path:ee,setup_proxy_console:j,set_thread_prefix:w,installUnhandledErrorHandler:Je,retrieve_asset_download:ie,invokeLibraryInitializers:be,isDebuggingSupported:Te,exceptions:t,simd:n,relaxedSimd:o};Object.assign(Ue,r),Object.assign(Pe,l)}(Fe);let nt,rt,it,st=!1,at=!1;async function lt(e){if(!at){if(at=!0,ke&&Pe.config.forwardConsoleLogsToWS&&void 0!==globalThis.WebSocket&&j("main",globalThis.console,globalThis.location.origin),We||Be(!1,"Null moduleConfig"),Pe.config||Be(!1,"Null moduleConfig.config"),"function"==typeof e){const t=e(Fe.api);if(t.ready)throw new Error("Module.ready couldn't be redefined.");Object.assign(We,t),Ee(We,t)}else{if("object"!=typeof e)throw new Error("Can't use moduleFactory callback of createDotnetRuntime function.");Ee(We,e)}await async function(e){if(Se){const e=await import(/*! webpackIgnore: true */"process"),t=14;if(e.versions.node.split(".")[0]<t)throw new Error(`NodeJS at '${e.execPath}' has too low version '${e.versions.node}', please use at least ${t}. See also https://aka.ms/dotnet-wasm-features`)}const t=/*! webpackIgnore: true */import.meta.url,o=t.indexOf("?");var n;if(o>0&&(Pe.modulesUniqueQuery=t.substring(o)),Pe.scriptUrl=t.replace(/\\/g,"/").replace(/[?#].*/,""),Pe.scriptDirectory=(n=Pe.scriptUrl).slice(0,n.lastIndexOf("/"))+"/",Pe.locateFile=e=>"URL"in globalThis&&globalThis.URL!==C?new URL(e,Pe.scriptDirectory).toString():M(e)?e:Pe.scriptDirectory+e,Pe.fetch_like=k,Pe.out=console.log,Pe.err=console.error,Pe.onDownloadResourceProgress=e.onDownloadResourceProgress,ke&&globalThis.navigator){const e=globalThis.navigator,t=e.userAgentData&&e.userAgentData.brands;t&&t.length>0?Pe.isChromium=t.some((e=>"Google Chrome"===e.brand||"Microsoft Edge"===e.brand||"Chromium"===e.brand)):e.userAgent&&(Pe.isChromium=e.userAgent.includes("Chrome"),Pe.isFirefox=e.userAgent.includes("Firefox"))}Ne.require=Se?await import(/*! webpackIgnore: true */"module").then((e=>e.createRequire(/*! webpackIgnore: true */import.meta.url))):Promise.resolve((()=>{throw new Error("require not supported")})),void 0===globalThis.URL&&(globalThis.URL=C)}(We)}}async function ct(e){return await lt(e),Ze=We.onAbort,Qe=We.onExit,We.onAbort=Ke,We.onExit=Ge,We.ENVIRONMENT_IS_PTHREAD?async function(){(function(){const e=new MessageChannel,t=e.port1,o=e.port2;t.addEventListener("message",(e=>{var n,r;n=JSON.parse(e.data.config),r=JSON.parse(e.data.monoThreadInfo),st?Pe.diagnosticTracing&&b("mono config already received"):(ve(Pe.config,n),Ue.monoThreadInfo=r,xe(),Pe.diagnosticTracing&&b("mono config received"),st=!0,Pe.afterConfigLoaded.promise_control.resolve(Pe.config),ke&&n.forwardConsoleLogsToWS&&void 0!==globalThis.WebSocket&&Pe.setup_proxy_console("worker-idle",console,globalThis.location.origin)),t.close(),o.close()}),{once:!0}),t.start(),self.postMessage({[l]:{monoCmd:"preload",port:o}},[o])})(),await Pe.afterConfigLoaded.promise,function(){const e=Pe.config;e.assets||Be(!1,"config.assets must be defined");for(const t of e.assets)X(t),Q[t.behavior]&&z.push(t)}(),setTimeout((async()=>{try{await oe()}catch(e){Xe(1,e)}}),0);const e=dt(),t=await Promise.all(e);return await ut(t),We}():async function(){var e;await Re(We),re();const t=dt();(async function(){try{const e=ee("dotnetwasm");await se(e),e&&e.pendingDownloadInternal&&e.pendingDownloadInternal.response||Be(!1,"Can't load dotnet.native.wasm");const t=await e.pendingDownloadInternal.response,o=t.headers&&t.headers.get?t.headers.get("Content-Type"):void 0;let n;if("function"==typeof WebAssembly.compileStreaming&&"application/wasm"===o)n=await WebAssembly.compileStreaming(t);else{ke&&"application/wasm"!==o&&E('WebAssembly resource does not have the expected content type "application/wasm", so falling back to slower ArrayBuffer instantiation.');const e=await t.arrayBuffer();Pe.diagnosticTracing&&b("instantiate_wasm_module buffered"),n=Ie?await Promise.resolve(new WebAssembly.Module(e)):await WebAssembly.compile(e)}e.pendingDownloadInternal=null,e.pendingDownload=null,e.buffer=null,e.moduleExports=null,Pe.wasmCompilePromise.promise_control.resolve(n)}catch(e){Pe.wasmCompilePromise.promise_control.reject(e)}})(),setTimeout((async()=>{try{D(),await oe()}catch(e){Xe(1,e)}}),0);const o=await Promise.all(t);return await ut(o),await Ue.dotnetReady.promise,await we(null===(e=Pe.config.resources)||void 0===e?void 0:e.modulesAfterRuntimeReady),await be("onRuntimeReady",[Fe.api]),Le}()}function dt(){const e=ee("js-module-runtime"),t=ee("js-module-native");if(nt&&rt)return[nt,rt,it];"object"==typeof e.moduleExports?nt=e.moduleExports:(Pe.diagnosticTracing&&b(`Attempting to import '${e.resolvedUrl}' for ${e.name}`),nt=import(/*! webpackIgnore: true */e.resolvedUrl)),"object"==typeof t.moduleExports?rt=t.moduleExports:(Pe.diagnosticTracing&&b(`Attempting to import '${t.resolvedUrl}' for ${t.name}`),rt=import(/*! webpackIgnore: true */t.resolvedUrl));const o=Y("js-module-diagnostics");return o&&("object"==typeof o.moduleExports?it=o.moduleExports:(Pe.diagnosticTracing&&b(`Attempting to import '${o.resolvedUrl}' for ${o.name}`),it=import(/*! webpackIgnore: true */o.resolvedUrl))),[nt,rt,it]}async function ut(e){const{initializeExports:t,initializeReplacements:o,configureRuntimeStartup:n,configureEmscriptenStartup:r,configureWorkerStartup:i,setRuntimeGlobals:s,passEmscriptenInternals:a}=e[0],{default:l}=e[1],c=e[2];s(Fe),t(Fe),c&&c.setRuntimeGlobals(Fe),await n(We),Pe.runtimeModuleLoaded.promise_control.resolve(),l((e=>(Object.assign(We,{ready:e.ready,__dotnet_runtime:{initializeReplacements:o,configureEmscriptenStartup:r,configureWorkerStartup:i,passEmscriptenInternals:a}}),We))).catch((e=>{if(e.message&&e.message.toLowerCase().includes("out of memory"))throw new Error(".NET runtime has failed to start, because too much memory was requested. Please decrease the memory by adjusting EmccMaximumHeapSize. See also https://aka.ms/dotnet-wasm-features");throw e}))}const ft=new class{withModuleConfig(e){try{return Ee(We,e),this}catch(e){throw Xe(1,e),e}}withOnConfigLoaded(e){try{return Ee(We,{onConfigLoaded:e}),this}catch(e){throw Xe(1,e),e}}withConsoleForwarding(){try{return ve(ze,{forwardConsoleLogsToWS:!0}),this}catch(e){throw Xe(1,e),e}}withExitOnUnhandledError(){try{return ve(ze,{exitOnUnhandledError:!0}),Je(),this}catch(e){throw Xe(1,e),e}}withAsyncFlushOnExit(){try{return ve(ze,{asyncFlushOnExit:!0}),this}catch(e){throw Xe(1,e),e}}withExitCodeLogging(){try{return ve(ze,{logExitCode:!0}),this}catch(e){throw Xe(1,e),e}}withElementOnExit(){try{return ve(ze,{appendElementOnExit:!0}),this}catch(e){throw Xe(1,e),e}}withInteropCleanupOnExit(){try{return ve(ze,{interopCleanupOnExit:!0}),this}catch(e){throw Xe(1,e),e}}withDumpThreadsOnNonZeroExit(){try{return ve(ze,{dumpThreadsOnNonZeroExit:!0}),this}catch(e){throw Xe(1,e),e}}withWaitingForDebugger(e){try{return ve(ze,{waitForDebugger:e}),this}catch(e){throw Xe(1,e),e}}withInterpreterPgo(e,t){try{return ve(ze,{interpreterPgo:e,interpreterPgoSaveDelay:t}),ze.runtimeOptions?ze.runtimeOptions.push("--interp-pgo-recording"):ze.runtimeOptions=["--interp-pgo-recording"],this}catch(e){throw Xe(1,e),e}}withConfig(e){try{return ve(ze,e),this}catch(e){throw Xe(1,e),e}}withConfigSrc(e){try{return e&&"string"==typeof e||Be(!1,"must be file path or URL"),Ee(We,{configSrc:e}),this}catch(e){throw Xe(1,e),e}}withVirtualWorkingDirectory(e){try{return e&&"string"==typeof e||Be(!1,"must be directory path"),ve(ze,{virtualWorkingDirectory:e}),this}catch(e){throw Xe(1,e),e}}withEnvironmentVariable(e,t){try{const o={};return o[e]=t,ve(ze,{environmentVariables:o}),this}catch(e){throw Xe(1,e),e}}withEnvironmentVariables(e){try{return e&&"object"==typeof e||Be(!1,"must be dictionary object"),ve(ze,{environmentVariables:e}),this}catch(e){throw Xe(1,e),e}}withDiagnosticTracing(e){try{return"boolean"!=typeof e&&Be(!1,"must be boolean"),ve(ze,{diagnosticTracing:e}),this}catch(e){throw Xe(1,e),e}}withDebugging(e){try{return null!=e&&"number"==typeof e||Be(!1,"must be number"),ve(ze,{debugLevel:e}),this}catch(e){throw Xe(1,e),e}}withApplicationArguments(...e){try{return e&&Array.isArray(e)||Be(!1,"must be array of strings"),ve(ze,{applicationArguments:e}),this}catch(e){throw Xe(1,e),e}}withRuntimeOptions(e){try{return e&&Array.isArray(e)||Be(!1,"must be array of strings"),ze.runtimeOptions?ze.runtimeOptions.push(...e):ze.runtimeOptions=e,this}catch(e){throw Xe(1,e),e}}withMainAssembly(e){try{return ve(ze,{mainAssemblyName:e}),this}catch(e){throw Xe(1,e),e}}withApplicationArgumentsFromQuery(){try{if(!globalThis.window)throw new Error("Missing window to the query parameters from");if(void 0===globalThis.URLSearchParams)throw new Error("URLSearchParams is supported");const e=new URLSearchParams(globalThis.window.location.search).getAll("arg");return this.withApplicationArguments(...e)}catch(e){throw Xe(1,e),e}}withApplicationEnvironment(e){try{return ve(ze,{applicationEnvironment:e}),this}catch(e){throw Xe(1,e),e}}withApplicationCulture(e){try{return ve(ze,{applicationCulture:e}),this}catch(e){throw Xe(1,e),e}}withResourceLoader(e){try{return Pe.loadBootResource=e,this}catch(e){throw Xe(1,e),e}}async download(){try{await async function(){lt(We),await Re(We),re(),D(),oe(),await Pe.allDownloadsFinished.promise}()}catch(e){throw Xe(1,e),e}}async create(){try{return this.instance||(this.instance=await async function(){return await ct(We),Fe.api}()),this.instance}catch(e){throw Xe(1,e),e}}async run(){try{return We.config||Be(!1,"Null moduleConfig.config"),this.instance||await this.create(),this.instance.runMainAndExit()}catch(e){throw Xe(1,e),e}}},mt=Xe,gt=ct;Ie||"function"==typeof globalThis.URL||Be(!1,"This browser/engine doesn't support URL API. Please use a modern version. See also https://aka.ms/dotnet-wasm-features"),"function"!=typeof globalThis.BigInt64Array&&Be(!1,"This browser/engine doesn't support BigInt64Array API. Please use a modern version. See also https://aka.ms/dotnet-wasm-features"),ft.withConfig(/*json-start*/{
  "mainAssemblyName": "Editor.Client",
  "resources": {
    "hash": "sha256-k4DhumzZrJx2UNtlWSaCMtrgFwadlXCQSeYwz0FmCVk=",
    "jsModuleNative": [
      {
        "name": "dotnet.native.my46u6sjp8.js"
      }
    ],
    "jsModuleRuntime": [
      {
        "name": "dotnet.runtime.v06hirbjsv.js"
      }
    ],
    "wasmNative": [
      {
        "name": "dotnet.native.lccqz8spb6.wasm",
        "hash": "sha256-+xuaP78u6l2Cf9uulqLxvustOkGuSTh+5Cyn18a6bYc=",
        "cache": "force-cache"
      }
    ],
    "coreAssembly": [
      {
        "virtualPath": "System.Runtime.InteropServices.JavaScript.wasm",
        "name": "System.Runtime.InteropServices.JavaScript.7y6jg6lppa.wasm",
        "hash": "sha256-7yEZGz65ZGFzE6eTlkn52I026xyS1Tbl3VFjMwsjhEw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Private.CoreLib.wasm",
        "name": "System.Private.CoreLib.vnz7v2apg7.wasm",
        "hash": "sha256-tahD0JmmRImvmk50Drv3nWNiVMyV3sVRI8WGBpDJMMI=",
        "cache": "force-cache"
      }
    ],
    "assembly": [
      {
        "virtualPath": "Blazor-Analytics.wasm",
        "name": "Blazor-Analytics.4ensyheg7d.wasm",
        "hash": "sha256-bIvCtkn88pVsOm5DqLGKrhR3kj1VwhhG8KdF1Hk8yLE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Blazored.LocalStorage.wasm",
        "name": "Blazored.LocalStorage.12n6dz54qr.wasm",
        "hash": "sha256-OaMAAd5n7ORfyur5e3QIyEVKJ76MKIvwbg7/icnnYcU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Blazored.SessionStorage.wasm",
        "name": "Blazored.SessionStorage.34xr2ein7y.wasm",
        "hash": "sha256-nQXuCGHos7iwp2WxRUgarKmWgJYChaVQp2NajgNU3V8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "ExCSS.wasm",
        "name": "ExCSS.kf2rou82s3.wasm",
        "hash": "sha256-8Gq5sGr5bYe17OLNLNtVme+803cBlugkbVfni3/KtVc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Grpc.Core.Api.wasm",
        "name": "Grpc.Core.Api.kr6zfbi4fx.wasm",
        "hash": "sha256-AFgm32GVnEKaLJQrwdfnn4hJoLSEc7xPhgCesUD70L4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Grpc.Net.Client.wasm",
        "name": "Grpc.Net.Client.rvgvda16vn.wasm",
        "hash": "sha256-yXOifmmffNOIcxo9fW3xMCbGAU6PjF+eRn7KxcH0gjY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Grpc.Net.Client.Web.wasm",
        "name": "Grpc.Net.Client.Web.w66z3jcf8v.wasm",
        "hash": "sha256-GJlO4XwuSR4p+Ji/3ZBruakFoZ3C25bVVNGVANi1A2I=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Grpc.Net.Common.wasm",
        "name": "Grpc.Net.Common.8v7c9rlmq5.wasm",
        "hash": "sha256-LIgtB/0NWTOH40xEQ3UtTXo+tdIMoCLjd7aowhcL9rg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "GrpcWebSocketBridge.Client.wasm",
        "name": "GrpcWebSocketBridge.Client.g53e8xzw97.wasm",
        "hash": "sha256-dGNSh1W7R/p6dY8t2C+CDrN69qii6H2w9xlPLpROBjw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "HarfBuzzSharp.wasm",
        "name": "HarfBuzzSharp.sdzakipcv8.wasm",
        "hash": "sha256-oH26UwE0EHYBHOEqUIstAxMpi9J/NSTRBWTLXjfRr7s=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MagicOnion.Abstractions.wasm",
        "name": "MagicOnion.Abstractions.6595hkcgtr.wasm",
        "hash": "sha256-dgFycts5UdLIIK1ITw+VdT1WqRtHizR/L5IoC99GsmQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MagicOnion.Client.wasm",
        "name": "MagicOnion.Client.tdmxq149re.wasm",
        "hash": "sha256-kW2c20qk15t2dTwc6v63WWvRK5IT08yh8vBd0PNK//k=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MagicOnion.Serialization.MessagePack.wasm",
        "name": "MagicOnion.Serialization.MessagePack.4zwcyp15p2.wasm",
        "hash": "sha256-8Odhwp5EYuAUVF5yBOMK5PtLOMOAaWrHd0cTa82NEB4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MagicOnion.Shared.wasm",
        "name": "MagicOnion.Shared.wd7n5ylb6z.wasm",
        "hash": "sha256-JIJ1qHwWIchCh+BU6ce12aqOoe+t6Jox04eI0IOysM0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Markdig.wasm",
        "name": "Markdig.yudascw6lc.wasm",
        "hash": "sha256-Vs+O4z19GqKw3tbW2sPDdGS0+/V6Y7ZqqYniikjBh58=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MemoryPack.Core.wasm",
        "name": "MemoryPack.Core.czx0bu0vck.wasm",
        "hash": "sha256-+HDwVKBM7lv/0/b6jJg9fuV6M5Cc/w9V/+X3ps1SHxs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MessagePack.wasm",
        "name": "MessagePack.fhyo2i0w27.wasm",
        "hash": "sha256-k45a7exscPJaoUW1Fx1mGY9Bc6RbRGTIrAfNE1gpQSA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MessagePack.Annotations.wasm",
        "name": "MessagePack.Annotations.3fw94h7bn4.wasm",
        "hash": "sha256-X6T/B2hLfscTRV8R+udP1isYQ3QedoqGTYRoezLWLNQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Authorization.wasm",
        "name": "Microsoft.AspNetCore.Authorization.s61l976zip.wasm",
        "hash": "sha256-vMGMZ+nYtzu5YTzlXSi8fkFf7SEos8SLx7v2ZAboVnQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Components.wasm",
        "name": "Microsoft.AspNetCore.Components.rxam81ap59.wasm",
        "hash": "sha256-32zrAmyJDmoknx8RvMmI26SWwGLQSNpIiZFJM/g4dz4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Components.Authorization.wasm",
        "name": "Microsoft.AspNetCore.Components.Authorization.klh3nn49mj.wasm",
        "hash": "sha256-2C4z/hngjPZOmh70zenUjqd2VxeE6qHxNpmadbFG7H4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Components.Forms.wasm",
        "name": "Microsoft.AspNetCore.Components.Forms.asf5fezmhi.wasm",
        "hash": "sha256-1glVwiaZHdSzP+hPEsRl90qfc5BKXDYn3BHGMKua11I=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Components.Web.wasm",
        "name": "Microsoft.AspNetCore.Components.Web.vkbayrweyw.wasm",
        "hash": "sha256-H4fZs/1DxaZDYxLNdmXIvo60jeFKZAB95UDgljPbKiY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Components.WebAssembly.wasm",
        "name": "Microsoft.AspNetCore.Components.WebAssembly.ecb8c5va1q.wasm",
        "hash": "sha256-kuRGhHwlIPXsKsQ9kQcqX6w3qHkfuUBpvStCdvCVnjk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Components.WebAssembly.Authentication.wasm",
        "name": "Microsoft.AspNetCore.Components.WebAssembly.Authentication.rkhu7cj4ih.wasm",
        "hash": "sha256-hQR6D2sxi0utxa39Ae/MQJ0yLxu+lbUlYIIme6YQMsI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.AspNetCore.Metadata.wasm",
        "name": "Microsoft.AspNetCore.Metadata.xyek1bobmw.wasm",
        "hash": "sha256-yXV5A1qp6pF+TWa/jC2wANlphPyvHxygiiAKua+C99w=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Configuration.wasm",
        "name": "Microsoft.Extensions.Configuration.47mkb8d5uo.wasm",
        "hash": "sha256-oDcpyYbqdkq6hP6NijTRWyXx2c2DKL6qilKSIzNmK3I=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Configuration.Abstractions.wasm",
        "name": "Microsoft.Extensions.Configuration.Abstractions.488ris6j7m.wasm",
        "hash": "sha256-ZMSiWFGZbJVZPj28eku0yZNbnGhFfzFj6gpep+3y9tw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Configuration.Json.wasm",
        "name": "Microsoft.Extensions.Configuration.Json.tsl8t8fg2u.wasm",
        "hash": "sha256-o5L9N1UOhqfOacmjcz9QfaqDLjHJf5HS/F+zQk1y9Ko=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.DependencyInjection.wasm",
        "name": "Microsoft.Extensions.DependencyInjection.qlvk7e1xzn.wasm",
        "hash": "sha256-AnRkR8z2viiDOXopsHSKrC7qYU0Vi1Mu3uao/PTtkrY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.DependencyInjection.Abstractions.wasm",
        "name": "Microsoft.Extensions.DependencyInjection.Abstractions.72oimyq7dk.wasm",
        "hash": "sha256-sbfcGuWjJMGZVUc3qKrii7oDNaQGfN0fa5d/M8yQXzU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Diagnostics.wasm",
        "name": "Microsoft.Extensions.Diagnostics.aywdphonwj.wasm",
        "hash": "sha256-7jpTpoeaqeTCO4/BIz4KTkxXO1jTvtord2+Qg24nbfI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Diagnostics.Abstractions.wasm",
        "name": "Microsoft.Extensions.Diagnostics.Abstractions.ox8zpfpx01.wasm",
        "hash": "sha256-/DwMjCWLivRtVrr4ak/cjUZWXjaUdb3fwR3h0hIIH0Y=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Hosting.Abstractions.wasm",
        "name": "Microsoft.Extensions.Hosting.Abstractions.ozlc3efc4a.wasm",
        "hash": "sha256-VMXD95Tp8ocuzGvDACGrTR+G6i65nmxt53qQIk2DNCQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Logging.wasm",
        "name": "Microsoft.Extensions.Logging.gf6ckg9yqi.wasm",
        "hash": "sha256-dHD+U2YdlcDKO7sHaHWnL0DXMmh1/ws8avyg32b0FsY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Logging.Abstractions.wasm",
        "name": "Microsoft.Extensions.Logging.Abstractions.eonscxbjxp.wasm",
        "hash": "sha256-InnfrBTkSF+QJy86EuBT+acf641GJE8YngMlEOoh34Q=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Options.wasm",
        "name": "Microsoft.Extensions.Options.iesqyi5uw7.wasm",
        "hash": "sha256-tjOzzp5i8p2rx1MvL+HymlJqswODtMsgvlkUOSlINWA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Extensions.Primitives.wasm",
        "name": "Microsoft.Extensions.Primitives.53666huos5.wasm",
        "hash": "sha256-rxHDRuDvkgr8ovvNhTAPo1R77aaj2ZdbtB1UhGxSITk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.JSInterop.wasm",
        "name": "Microsoft.JSInterop.0cfaogzq3p.wasm",
        "hash": "sha256-IHSxo8WrrrR9AInJJXQDAemk5205Z555AKYsXCu61FA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.JSInterop.WebAssembly.wasm",
        "name": "Microsoft.JSInterop.WebAssembly.vjcfjtelwd.wasm",
        "hash": "sha256-tWu37j/RoE6Pwu6s46idTVIaPuEWCkAbsWSyzgKFWXI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.NET.StringTools.wasm",
        "name": "Microsoft.NET.StringTools.93u68c8kyf.wasm",
        "hash": "sha256-1RVVzhRL2Hx7k7A5ZItnCkz9CRPPvSmTRUPLCFSRG2o=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Nanoid.wasm",
        "name": "Nanoid.pcdp5nitgb.wasm",
        "hash": "sha256-2VC/7rZ5XBdXO9C0HCg6Md5HEqkSvr8D1Qu53mBSuk0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Polly.wasm",
        "name": "Polly.pos1ijmk3h.wasm",
        "hash": "sha256-eSXY+B0UR7o5vq1w0+MYQU84lXRsKRij1hP/2bsV86I=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Polly.Core.wasm",
        "name": "Polly.Core.40mckuk98k.wasm",
        "hash": "sha256-nLkh8NvGoOSBeRP5uhmsUb5ihjx5uMoU+TqmVBD8Rv4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "R3.wasm",
        "name": "R3.3ngmk163uv.wasm",
        "hash": "sha256-QaoVxez34nTBCIt/9TOp0DBq5yacbRHN3J247IlCyus=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "R3.BlazorWebAssembly.wasm",
        "name": "R3.BlazorWebAssembly.yg2sx1k6p3.wasm",
        "hash": "sha256-ft8b8006sjaUx8nOzCjcWIRfIQGhVi/ZDJXGCoCe5M8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Radzen.Blazor.wasm",
        "name": "Radzen.Blazor.d1bj9xkpib.wasm",
        "hash": "sha256-oQsT4FpjgihA9PNK+7g4gzRPhoTD6l/xAEP4rpQ64Gs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "SkiaSharp.wasm",
        "name": "SkiaSharp.4gssu8ss7z.wasm",
        "hash": "sha256-/MLdk6i9RKDdD5LWuqDmeEOgYAwPelvQ5akF7KvIb0E=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "SkiaSharp.HarfBuzz.wasm",
        "name": "SkiaSharp.HarfBuzz.b22s0dz5hj.wasm",
        "hash": "sha256-c72h3ML5ME05dqE4g6ypYT8myBzNb7AiBJR8EIx2E7I=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "SkiaSharp.Views.Blazor.wasm",
        "name": "SkiaSharp.Views.Blazor.h7o6pq9wip.wasm",
        "hash": "sha256-806wFJybXyLCLU1uTIFPFPL2n9R0sXjzZHtbKNzQqeo=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Stateless.wasm",
        "name": "Stateless.hwcb405m6v.wasm",
        "hash": "sha256-EWplLf93o2pQw4CGMvCTYO234EMwTX1tSqc2xJ8JbCw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "ZstdSharp.wasm",
        "name": "ZstdSharp.16l88inodj.wasm",
        "hash": "sha256-KR3cAHwB6xsvw0WXeCcP8OnTHPehbTBzJ5VbX5vlOVU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.CSharp.wasm",
        "name": "Microsoft.CSharp.2wwqorzs5q.wasm",
        "hash": "sha256-Ar3kYj+DeWUmYaBgaTP4OQ+HUmwLEWfNitU/Cvoe7UE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.Concurrent.wasm",
        "name": "System.Collections.Concurrent.0p3o1du5zx.wasm",
        "hash": "sha256-TMKIbdL0i76tbbO1iVc9I5L+9HETCT6uXx0ULRRqcmE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.Immutable.wasm",
        "name": "System.Collections.Immutable.p89stiq3bm.wasm",
        "hash": "sha256-yUJwrTn1H3Y/EpI+T4vW9GF6f1kFBNR5y+ZKXENoh2k=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.NonGeneric.wasm",
        "name": "System.Collections.NonGeneric.je1yo12j8p.wasm",
        "hash": "sha256-ZShNVRUSARfhYe21AlvBKsoCCQq+AK/yefCYxwoqLnQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.Specialized.wasm",
        "name": "System.Collections.Specialized.ocycxf44si.wasm",
        "hash": "sha256-6NWf8OnZ69MhHN2hsIKCZE0e2+zbCLmRVANmnCD8LHo=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.wasm",
        "name": "System.Collections.vxeiznv05v.wasm",
        "hash": "sha256-3TT5zDMqQWPcVspsOdvIepBe3cPu/YE5/2Pcjdh+61o=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ComponentModel.Annotations.wasm",
        "name": "System.ComponentModel.Annotations.02hhz2ngea.wasm",
        "hash": "sha256-aNQIotQNrMmupnuv6GVsjT/jgk01jp5GC1O4RZtfALI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ComponentModel.Primitives.wasm",
        "name": "System.ComponentModel.Primitives.6wyhp2igzg.wasm",
        "hash": "sha256-GhQHfPeRMvvHB0GJJc/g55HLmHCPNr0BLkQtlQK5XxM=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ComponentModel.TypeConverter.wasm",
        "name": "System.ComponentModel.TypeConverter.8id58r4bnc.wasm",
        "hash": "sha256-oCdwXaA8nWImTG5gyJ6e/0EhuYrhq/0jVr31Q2D5cXk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ComponentModel.wasm",
        "name": "System.ComponentModel.pr1nwnlbyj.wasm",
        "hash": "sha256-tVQwvFurArJLkA6HWjWb8LufydAATqVd8aLijHbFzCY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Console.wasm",
        "name": "System.Console.ipniqdx8ma.wasm",
        "hash": "sha256-hgazrlgdomNHq1S1Ejub0OT9Fm1WoAIUReoLaVfjElk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Core.wasm",
        "name": "System.Core.oukq8npmv4.wasm",
        "hash": "sha256-8D8668KatzrWo01yEXgsTkMbeq6/y5S8tDp0iQbWO/E=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Data.Common.wasm",
        "name": "System.Data.Common.snmv6w10gf.wasm",
        "hash": "sha256-eNr/B3Wg8EhF6jfFCXs3vCk2UEjb9JWXX7gIwC/8xJg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.DiagnosticSource.wasm",
        "name": "System.Diagnostics.DiagnosticSource.kg5dkr4g0b.wasm",
        "hash": "sha256-5HzV7TbQqdMHtBAFEA/TJ4k7LkioKmDDC6Zh3bcVO24=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.StackTrace.wasm",
        "name": "System.Diagnostics.StackTrace.guon9v0p2x.wasm",
        "hash": "sha256-eF0UPNEnnTvIZCDNuDQTwT4R36JOXbaCxuzLymgAxps=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.Tracing.wasm",
        "name": "System.Diagnostics.Tracing.kbd3zfuu8u.wasm",
        "hash": "sha256-MGWCs3vMrPAy4UmYK4RsmGfccjNhxTML9UkEhFbKrnY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Drawing.Primitives.wasm",
        "name": "System.Drawing.Primitives.pntxzh950l.wasm",
        "hash": "sha256-mzTvlwbNVySksY3Ke7jAOVGBYO2Gaye0cE5fV39bSkY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Drawing.wasm",
        "name": "System.Drawing.1b7uoq5l4d.wasm",
        "hash": "sha256-fdBffYkGgqR5wGynKyuUsTqc1flMEnTicRL3rszhKVg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Compression.Brotli.wasm",
        "name": "System.IO.Compression.Brotli.tr4n0rfncm.wasm",
        "hash": "sha256-F4xiJc7ffAvcTm67k1NojAE82TOqJutN2GLp8nguyLY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Compression.wasm",
        "name": "System.IO.Compression.05qus8b0em.wasm",
        "hash": "sha256-1EtEdW7W5hgPPxH76NBCj6dsAQiRy3IwM9R7P2sjHwc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Pipelines.wasm",
        "name": "System.IO.Pipelines.agbk7vq3d7.wasm",
        "hash": "sha256-+hnn2WwCJ596wMTcNVX4xoz0LBbjGip1o41JV2dmUPw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Linq.Expressions.wasm",
        "name": "System.Linq.Expressions.ztvitawwlx.wasm",
        "hash": "sha256-pxbSd1TLFUcFQK1GBprngLgX1sRRFhJ0tK+HQRTiUWM=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Linq.Queryable.wasm",
        "name": "System.Linq.Queryable.kjkymkq8et.wasm",
        "hash": "sha256-gB2zfdbOOVfkmmodWUgUXJpRzU6saP3eNGlVmJ8L0HA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Linq.wasm",
        "name": "System.Linq.uuzix9333d.wasm",
        "hash": "sha256-+gRWttcCHWj1W2qiIbaxPZDzCIDjP+P0cKIPnrjroIM=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Memory.wasm",
        "name": "System.Memory.l7tg4m1bg5.wasm",
        "hash": "sha256-H5xT0+fEYXjQn9rR0Kxj3UK6xu5cEI+iMOUSLbe1uzE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Http.Json.wasm",
        "name": "System.Net.Http.Json.q39k2tnbym.wasm",
        "hash": "sha256-FnE3a4eZccI3DRVQAj+MkGJR1v0spgeulbQ+MlUfLxY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Http.wasm",
        "name": "System.Net.Http.1f9u9zpmks.wasm",
        "hash": "sha256-00+ZxrgcfND5qG3nM7vj5KQRt3AndKlHDeeUJ0wTCQk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.NameResolution.wasm",
        "name": "System.Net.NameResolution.fauhrw0vux.wasm",
        "hash": "sha256-l+7AXtIJVLR7K966wbYGrxDA/kwotVwN5xR2xETFh10=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Primitives.wasm",
        "name": "System.Net.Primitives.47rbk15gug.wasm",
        "hash": "sha256-cObwE/eYiZhQRh1aVQb3cFM/XSGLy0sNGoe5Awh0xGY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Sockets.wasm",
        "name": "System.Net.Sockets.jer5tws19a.wasm",
        "hash": "sha256-BSmLAUmhA7Oy+605cj540TwX+JFCUplU+NVWiq0K+MQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.WebSockets.Client.wasm",
        "name": "System.Net.WebSockets.Client.24o7fnixgk.wasm",
        "hash": "sha256-Lv8vU0VHeSPQcNonroeO8hzqprCIka7CMtSx30jo7x4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.WebSockets.wasm",
        "name": "System.Net.WebSockets.ssw6rj0smr.wasm",
        "hash": "sha256-jBLU7epUCXF2WpNpNAlhqc2FTHfuaeNAxHs6o/XotjM=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Numerics.Vectors.wasm",
        "name": "System.Numerics.Vectors.x5xfalegjx.wasm",
        "hash": "sha256-pfMIscAuJuVUYf+3vXW1MQZxKzuAPtH7W+Wj/2yTSJs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ObjectModel.wasm",
        "name": "System.ObjectModel.3hysn85hdd.wasm",
        "hash": "sha256-eTvaziOFB1yZLdSXnPKOS8/ZM98z4tSFjLMw1qtWdBs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Private.Uri.wasm",
        "name": "System.Private.Uri.edgrp9dz6d.wasm",
        "hash": "sha256-XmdrMEP2Slu0VPvSUgP3/k434gX4ti1UXtOtaelCaZY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Private.Xml.Linq.wasm",
        "name": "System.Private.Xml.Linq.nmi4klwoz0.wasm",
        "hash": "sha256-Tz/+aG7GYbxYUwTP0JW1F1bgjQbAqqtFiU1zN8lRFbc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Private.Xml.wasm",
        "name": "System.Private.Xml.iuck8123z4.wasm",
        "hash": "sha256-CgpiNPPFHKJnTAOM5KQCw+Fchfi00SpZc0LOd32ZxD0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Emit.ILGeneration.wasm",
        "name": "System.Reflection.Emit.ILGeneration.fqw9ai6chf.wasm",
        "hash": "sha256-9z+51k3YIppeigvMeP6L7ybqb7CaORMmkCUFgYvXpAA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Emit.wasm",
        "name": "System.Reflection.Emit.1ofyimt31d.wasm",
        "hash": "sha256-0X1kIKUj4O94kH7wj2djjp5BICfm8R8nEDItRiV+KXs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Primitives.wasm",
        "name": "System.Reflection.Primitives.y0t06ffh5m.wasm",
        "hash": "sha256-DtvUByUM7iugi+iZbOUqRTAFa9/57eM6sEANIyhYeI4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.InteropServices.wasm",
        "name": "System.Runtime.InteropServices.0lbmmcgyh6.wasm",
        "hash": "sha256-JOphI8UBDfRYPMoPVWX6vtbIvIl2X5JrfC/mHtvh7ks=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Intrinsics.wasm",
        "name": "System.Runtime.Intrinsics.59f9kcnhn0.wasm",
        "hash": "sha256-eakqOzOkp0Mj/WG0i0fuK0e4F/dENzwC+AF5SXmatt0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Loader.wasm",
        "name": "System.Runtime.Loader.7i20r5qyx9.wasm",
        "hash": "sha256-UaTF/sBHx3iQpQ9oPORd2zLI/0sqWWMHLreV7NJ5oRc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Numerics.wasm",
        "name": "System.Runtime.Numerics.kgn8d7xqow.wasm",
        "hash": "sha256-xGFJ+brBUWoJqDpyKCQePBx+OkQd2TGO6JazjUJsFjc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Serialization.Primitives.wasm",
        "name": "System.Runtime.Serialization.Primitives.wivr8r6iib.wasm",
        "hash": "sha256-WAwJuKhTQ0wLrZZuCdjmgYriNS8Sr0FxrD/jIKSP+9U=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.wasm",
        "name": "System.Runtime.jk1v00cltl.wasm",
        "hash": "sha256-Teb4HKJjJkbC6zYeOr7/yzqvVFHamdZrEu8h2uSKQxk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Security.Claims.wasm",
        "name": "System.Security.Claims.d4suuhgl57.wasm",
        "hash": "sha256-IxSHi2rL83GPbsm2KpFzULzjnynEUHKYZL+GtQvLHFI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Security.Cryptography.wasm",
        "name": "System.Security.Cryptography.jave0zop89.wasm",
        "hash": "sha256-FT4HZM4hBdSSr6h9PcrfOBxWM3hV66bcJJqFx4JNZCU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.Encoding.Extensions.wasm",
        "name": "System.Text.Encoding.Extensions.ajdtrmih3n.wasm",
        "hash": "sha256-xlzDXaEN8BlJZ/cmxpvjDbpYqmXAnU9S7pNhE10wL74=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.Encodings.Web.wasm",
        "name": "System.Text.Encodings.Web.e41sensx7n.wasm",
        "hash": "sha256-rn4OcVwLvQpN8XomVLScacbWFmEQaFHywlF7oH+6dI0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.Json.wasm",
        "name": "System.Text.Json.hkiokj0b72.wasm",
        "hash": "sha256-/wvI4emuOJLNevbNcOtEEz9rC442ei/DC86wFrlA88A=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.RegularExpressions.wasm",
        "name": "System.Text.RegularExpressions.jr06jh5qa0.wasm",
        "hash": "sha256-X/A3UlthQksrG71ZFL20MW1TmDJQXk2HO5SEUeKeOvQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.Channels.wasm",
        "name": "System.Threading.Channels.cbgm1c0pnw.wasm",
        "hash": "sha256-GI30WgEdlm5gckkb18VUsi4UogcVRVZb4vyvJiuf7OI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.Tasks.Extensions.wasm",
        "name": "System.Threading.Tasks.Extensions.p2kmtlhobi.wasm",
        "hash": "sha256-IdAfbfVhbvwOf/LnuZQ24NSnigukG809LDUN8LPHLfM=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.Thread.wasm",
        "name": "System.Threading.Thread.5ry1asi5th.wasm",
        "hash": "sha256-z/9sp9813ITXlJUi0QmOUPMRNX77BVzO6yU0bIKss/w=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.ThreadPool.wasm",
        "name": "System.Threading.ThreadPool.2wp3v7hjpk.wasm",
        "hash": "sha256-Lo/wZJ2l95HELgXz4g5rfoNovDxWk9iejD1vZnR94v4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.wasm",
        "name": "System.Threading.nywcjnh2y7.wasm",
        "hash": "sha256-33A/53dyHRgFy1DQMqZyZKc6Jn7wGiVD6e6ymxdcu0Q=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Web.HttpUtility.wasm",
        "name": "System.Web.HttpUtility.g4h873c6x9.wasm",
        "hash": "sha256-UGQ3bxKxH97ueJzBbQL5prM5lSgibF5buRBJJfPchw4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Xml.Linq.wasm",
        "name": "System.Xml.Linq.pzw688hdq1.wasm",
        "hash": "sha256-e5txtle0V/jlZ+5laxHe+k2o2xewHh66AVpDrj8yXlc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Xml.XDocument.wasm",
        "name": "System.Xml.XDocument.kg5jr6em32.wasm",
        "hash": "sha256-nCrXPw/XpdWa/aJnXScl6PF8UX3cntkiMTqcomNjGZE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.wasm",
        "name": "System.400l3mulw9.wasm",
        "hash": "sha256-vPEm2KqgXqruGwnz718iSgmDoB8Img7iH3FzO57b0Rg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "netstandard.wasm",
        "name": "netstandard.k0gdgpqm15.wasm",
        "hash": "sha256-rDn8s1sQCSzuUn1/P2oiJU1V0N2wT5bDVS4uYjdImAQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Blazor.IndexedDB.wasm",
        "name": "Blazor.IndexedDB.kx61p8jpir.wasm",
        "hash": "sha256-WCI3z+nkVgRdJkGHRbSIyE6xBoCCXSY2K0GyiM9SHhc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Graphics.Core.wasm",
        "name": "Graphics.Core.rdnbyam6qp.wasm",
        "hash": "sha256-H/UoG5jngfZg0a4/g0CYFXgxVJeKtaID4R9kY3YUHJI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Math.Core.wasm",
        "name": "Math.Core.tycw7b6sg0.wasm",
        "hash": "sha256-pdy4LK0A0uhbm44JzBQPm/7P1SQ1cZNhcvycGoJBxsk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "RBush.wasm",
        "name": "RBush.jj0sdlnk09.wasm",
        "hash": "sha256-vwK8NFUHmP9um49pcEjHCgIYpBhu60hm39R9qM01tQU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Editor.Client.wasm",
        "name": "Editor.Client.7q4juxe4tm.wasm",
        "hash": "sha256-r4BuMirjnv1nUISN6Qd/AGjWUimq1Iju3mGf1TfKeS4=",
        "cache": "force-cache"
      }
    ],
    "satelliteResources": {
      "de": [
        {
          "virtualPath": "Radzen.Blazor.resources.wasm",
          "name": "Radzen.Blazor.resources.u2yixkz2m3.wasm",
          "hash": "sha256-Br6tQwj69SB/+9YnTn0q7fu22sOL8AQo0esuX6oYdn8=",
          "cache": "force-cache"
        }
      ],
      "es": [
        {
          "virtualPath": "Radzen.Blazor.resources.wasm",
          "name": "Radzen.Blazor.resources.tcisscumn8.wasm",
          "hash": "sha256-EwiqGbzg8HTXu6HN9ddXri6f4eOTjxf2cKGVDkib/qw=",
          "cache": "force-cache"
        }
      ],
      "fr": [
        {
          "virtualPath": "Radzen.Blazor.resources.wasm",
          "name": "Radzen.Blazor.resources.cukfohytcf.wasm",
          "hash": "sha256-vIwDYXOUYeXZfS2+7FcrLkDM+FMsRV31FcabNEMz5oE=",
          "cache": "force-cache"
        }
      ],
      "it": [
        {
          "virtualPath": "Radzen.Blazor.resources.wasm",
          "name": "Radzen.Blazor.resources.flzwdoe4r9.wasm",
          "hash": "sha256-M+luA7R0FiRxGwebRv/AYKuMQsdOXDIYEswHE2Z5uaU=",
          "cache": "force-cache"
        }
      ],
      "ja": [
        {
          "virtualPath": "Radzen.Blazor.resources.wasm",
          "name": "Radzen.Blazor.resources.e8zh2k4nx4.wasm",
          "hash": "sha256-nt5ZQv2wdhFSCCDNB+Ls8KakkJhGkAAnJWlHljWWDnQ=",
          "cache": "force-cache"
        }
      ]
    },
    "libraryInitializers": [
      {
        "name": "_content/Microsoft.AspNetCore.Components.CustomElements/Microsoft.AspNetCore.Components.CustomElements.lib.module.js"
      }
    ],
    "modulesAfterRuntimeReady": [
      {
        "name": "../_content/Microsoft.AspNetCore.Components.CustomElements/Microsoft.AspNetCore.Components.CustomElements.lib.module.js"
      }
    ]
  },
  "debugLevel": 0,
  "linkerEnabled": true,
  "globalizationMode": "invariant",
  "extensions": {
    "blazor": {}
  },
  "runtimeConfig": {
    "runtimeOptions": {
      "configProperties": {
        "Microsoft.AspNetCore.Components.Routing.RegexConstraintSupport": false,
        "Microsoft.Extensions.DependencyInjection.VerifyOpenGenericServiceTrimmability": true,
        "System.ComponentModel.DefaultValueAttribute.IsSupported": false,
        "System.ComponentModel.Design.IDesignerHost.IsSupported": false,
        "System.ComponentModel.TypeConverter.EnableUnsafeBinaryFormatterInDesigntimeLicenseContextSerialization": false,
        "System.ComponentModel.TypeDescriptor.IsComObjectDescriptorSupported": false,
        "System.Data.DataSet.XmlSerializationIsSupported": false,
        "System.Diagnostics.Debugger.IsSupported": false,
        "System.Diagnostics.Metrics.Meter.IsSupported": false,
        "System.Diagnostics.Tracing.EventSource.IsSupported": false,
        "System.GC.Server": true,
        "System.Globalization.Invariant": true,
        "System.TimeZoneInfo.Invariant": false,
        "System.Globalization.PredefinedCulturesOnly": true,
        "System.Linq.Enumerable.IsSizeOptimized": true,
        "System.Net.Http.EnableActivityPropagation": false,
        "System.Net.Http.WasmEnableStreamingResponse": true,
        "System.Net.SocketsHttpHandler.Http3Support": false,
        "System.Reflection.Metadata.MetadataUpdater.IsSupported": false,
        "System.Resources.ResourceManager.AllowCustomResourceTypes": false,
        "System.Resources.UseSystemResourceKeys": true,
        "System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeSupported": true,
        "System.Runtime.InteropServices.BuiltInComInterop.IsSupported": false,
        "System.Runtime.InteropServices.EnableConsumingManagedCodeFromNativeHosting": false,
        "System.Runtime.InteropServices.EnableCppCLIHostActivation": false,
        "System.Runtime.InteropServices.Marshalling.EnableGeneratedComInterfaceComImportInterop": false,
        "System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization": false,
        "System.StartupHookProvider.IsSupported": false,
        "System.Text.Encoding.EnableUnsafeUTF7Encoding": false,
        "System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault": true,
        "System.Threading.Thread.EnableAutoreleasePool": false,
        "Microsoft.AspNetCore.Components.Endpoints.NavigationManager.DisableThrowNavigationException": false
      }
    }
  }
}/*json-end*/);export{gt as default,ft as dotnet,mt as exit};
