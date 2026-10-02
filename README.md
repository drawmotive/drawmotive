# @drawmotive/editor

Embed the DrawMotive visual diagram editor in a web page. Start with TextGraph, move and edit shapes on the canvas, then export a PNG and an editable document.

[Try the browser example](https://textgraph.dev/examples/editor/) · [Documentation](https://textgraph.dev/editor/) · [Report an issue](https://github.com/drawmotive/drawmotive/issues)

Use **@drawmotive/textgraph** to render text to a PNG. Use **@drawmotive/editor** when people need to edit the resulting diagram visually. The editor runs locally in the browser; no account or rendering service is required.

## Install

```bash
npm install @drawmotive/editor@0.2.2-alpha.2
npx drawmotive-copy-assets public/editor
```

Copy the assets again after every package upgrade. Deploy the complete `public/editor` directory with your application. For Vite, add `drawmotive-copy-assets public/editor` to both `predev` and `prebuild`.

## Supported environments

| Layer | Supported environment | Verification boundary |
| --- | --- | --- |
| Package development and asset-copy CLI | Node.js 22; npm 10 | Applications using Vite require Node 22.12+ on the 22 line |
| Desktop build and packaging | Linux, Windows, macOS | CI targets all three systems with Node 22 |
| Visual editor | Current Chromium on HTTPS or localhost | The browser suite covers Chromium; Firefox, WebKit and mobile browsers are not currently verified |
| Server rendering | Import during SSR is supported | Mounting, editing and export require a browser; there is no Node or Worker editor |

The standalone package audit on 2026-10-01 ran Linux x64 with Node 22.23.2
and npm 10.9.8. Declared OS/Node support and CI jobs do not imply that the
other platforms or the browser suite ran in that audit. Browser hosts need
WebAssembly, JavaScript modules, browser storage and correct HTML/WASM serving.

## Mount an editor

Give the container an explicit height:

```html
<div id="diagram-editor" style="height: 600px"></div>
```

```javascript
import { initializeEditor } from '@drawmotive/editor';

const editor = await initializeEditor({
  container: document.querySelector('#diagram-editor'),
  assetBaseUrl: '/editor/',
  source: 'User -> Application -> Database',
});

const { raw, png, width, height } = await editor.exportDocument();
// Persist raw to reopen the editable diagram. png is a base64-encoded PNG.
await editor.importDocument(raw);

// When the component unmounts:
await editor.dispose();
```

Omit `source` for a blank canvas, or pass `document: savedRaw` to reopen a saved diagram. Do not pass both. Initialization resolves after the editor and its initial diagram are ready.

The [complete HTML/JavaScript example](examples/browser/index.html) includes TextGraph input, visual editing, PNG download, and document save/open. Serve the package directory over localhost to run it without a bundler. Its import map resolves the package's own JavaScript and runtime files.

## API

| Method | Result |
| --- | --- |
| `initializeEditor({ container, assetBaseUrl, source?, document?, signal?, title?, timeoutMs? })` | Ready `EditorInstance` |
| `editor.importTextGraph(source)` | Replaces the diagram with laid-out TextGraph |
| `editor.importDocument(raw)` | Replaces the diagram with an exported document |
| `editor.exportDocument()` | `{ raw, png, width, height }` |
| `editor.dispose()` | Removes the frame and releases the runtime |

All methods return promises. Catch errors to show feedback in your application. Invalid imports preserve the current diagram. `signal` cancels initialization, including the initial import. `timeoutMs` defaults to 120000 for initialization and requests. Disposing rejects pending work and is safe to repeat.

`raw` is an opaque base64 DrawMotive document, not TextGraph source. Save it to your own storage; the embedded editor uses temporary browser storage, which is not durable document storage. PNG output is a preview and does not replace the editable document.

## Browser deployment

Serve over HTTPS or localhost with JavaScript modules and `.wasm` files (`application/wasm`). `assetBaseUrl` is the directory containing `embed.html`; use a URL that includes your application's deployment prefix. Without it, an unbundled import resolves assets relative to the installed package. Bundled applications should always set it explicitly.

Each instance uses an iframe to isolate its styles, .NET runtime and document. The frame has an accessible title and fills the supplied container. Loading multiple editors loads multiple runtimes, so dispose instances when no longer needed. The package can be imported during SSR, but mounting requires a browser. There is no Node.js or Worker visual editor entry.

The frame uses Blazor's built-in concurrent WASM loader, with its normal integrity checks and browser caching. It does not depend on the TextGraph SDK's startup loader; upgrading `@drawmotive/textgraph` does not change the editor runtime.

The host application owns saving, upload, and collaboration. This initial browser API does not expose account login, server synchronization, custom toolbar adapters or TextGraph export.

## Development and release

```bash
npm ci
npm test
npm run build
npm run assets:verify
npx playwright install chromium
npm run test:browser
npm pack
```

The package contains compiled runtime assets with an integrity manifest. Release checks verify their version, producer commit and hashes before packaging. No .NET SDK or private source checkout is needed to consume the package. The publication audit rejects original C#/Razor source, debug symbols, source maps and embedded portable PDBs. Compiled .NET assemblies are shipped and can be decompiled; this is not source secrecy or copy protection.

## License

Package code is MIT licensed. Bundled dependencies and fonts retain their own license notices.
See [NOTICE](NOTICE), [Contributing](CONTRIBUTING.md) and [Changelog](CHANGELOG.md).
Vulnerability reports follow [Security reporting](SECURITY.md).
