# @drawmotive/editor

Embed the DrawMotive visual editor and compose your own document, save and publish flows. Each instance owns an isolated browser runtime. The public SDK exposes editing operations and state; the host owns files, accounts and external persistence.

[Browser example](examples/browser/index.html) · [Documentation](https://textgraph.dev/editor/) · [Report an issue](https://github.com/drawmotive/drawmotive/issues)

## Example output

<!-- public-preview:start -->

```textgraph
(horizontal)

checkout(primary): Checkout {
  order -> payment
  payment ->(dashed warning) order : No, retry
}

fulfillment(success): Fulfillment {
  ship -> delivered
  email
}

payment -> ship : Yes
payment -> email : Yes

order: Place order
payment(diamond fill primary): Paid?
ship: Ship order
email: Email receipt
delivered(ellipse fill success): Delivered
```

![Online order: checkout and fulfillment, with a payment decision, a dashed retry loop, and parallel shipping and email receipt branches.](examples/online-order.png)

[Open the full diagram](examples/online-order.png) · [Copy the source](examples/online-order.textgraph) · [Try this diagram](https://textgraph.dev/playground?d=1.eJxNj71uwzAQg_d7Co4y0LyAhmToz1gE6NRRkC71obIkSHILp-i7F5KduNuB4H0k1RizXGOoxg9EdmT7GeeqUpbJ5GXQeNwk_BAQs-OMwxHJLBOHSrhdOByVM2Vkh2-Tg4SPYXNrvMYHZK55oV-iy-wv4n37UWW2lksZNF52tQeVUVLLcezlizM7Angy4htij1x9Gu9c_qvducnUW2icvbG8VrpZlRMzxeDQorFPPhtxJ2pojbcWsH51qsZzh2e2LKnSvaBi7yUVXmH7sqf7gj9nDXvi)

<!-- public-preview:end -->

For Chinese, Japanese, and color emoji, see the [packaged font examples](https://github.com/drawmotive/textgraph/tree/main/language-packs#language-coverage).

## Running in a browser

![The standalone DrawMotive demo inside Chromium, including browser tabs and address bar, TextGraph controls, and editable canvas.](examples/editor-browser.png)

Serve the [browser example](examples/browser/index.html) over HTTP to generate the diagram and edit it visually.

To refresh documentation captures from the parent workspace, run
`npm run docs:capture -- editor`, then `npm run docs:previews -- sync` and
`npm run docs:previews -- check`. This uses the unchanged browser example,
headed Chromium, an isolated Xvfb display and a real display capture. Browser
tabs and address bar must be visible. The adjacent capture record contains
application/package versions, dimensions and source/pixel hashes.

## Install

```bash
npm install @drawmotive/editor@0.3.0
npx drawmotive-copy-assets public/editor
```

Copy the complete runtime after every upgrade. For Vite, run `drawmotive-copy-assets public/editor` in `predev` and `prebuild`. Serve runtime assets through HTTP(S), including `.wasm` as `application/wasm`; bundled applications must set `assetBaseUrl` explicitly.

Hosts with an authenticated resource transport can supply `frameDocument: { url, html }`.
The bootstrap URL must be HTTP(S) on the host's own origin; the SDK loads it before
writing trusted runtime HTML so its service worker remains available. The host
owns that HTML's CSP and resource base. The SDK still authenticates the frame
window and bootstrap origin before opening its private message port.

## Create and edit

```html
<div id="editor" style="height: 600px"></div>
```

```javascript
import { createEditor } from "@drawmotive/editor";

const editor = await createEditor({
  container: document.querySelector("#editor"),
  assetBaseUrl: "/editor/",
  ui: { buttons: { help: false } },
  modules: { analytics: false, authentication: false, remoteSync: false },
});
await editor.replaceTextGraph("User -> Application -> Database");
await editor.fitViewport();
const unsubscribe = editor.onStateChanged(state => console.log(state.revision));
const snapshot = await editor.exportSnapshot({ formats: ["raw", "png"] });
await persistDocument(snapshot.raw, snapshot.revision);
unsubscribe();
await editor.dispose();
```

Creation resolves after the configured empty scene and storage are ready. Replacement and fitting are separate operations. `raw` is an opaque base64 editable document, not TextGraph source. Runtime IndexedDB is temporary and deleted during disposal; it is not a durable document file.

TextGraph to canvas is intentionally a one-way workflow. Canvas edits belong to the saved document and do not rewrite TextGraph. Calling `replaceTextGraph()` again creates a replacement document; it does not merge source changes with earlier canvas edits.

## Operations

| Operation | Result or effect |
| --- | --- |
| `createEditor(options)` | Ready isolated instance |
| `replaceDocument(raw)` | Validates and replaces; resets selection/history |
| `replacePngDocument(base64)` | Validates a PNG with an embedded editable document, then replaces |
| `replaceTextGraph(source)` / `clearDocument()` | Establishes a new document |
| `exportSnapshot({ formats, render?, png? })` | Requested formats from one revision |
| `fitViewport({ padding?, minScale?, maxScale? })` | Display only; defaults: 60, 0.2, 1 |
| `setEditingEnabled(enabled)` | Controls user edits and JS history; loading/export remain available |
| `undo()` / `redo()` | Applies document history |
| `getState()` / `onStateChanged(listener)` | Current state / subscription with immediate replay |
| `setActionState(id, { label?, enabled?, visible? })` | Updates a declared host action |
| `dispose()` | Releases the frame and temporary storage |

State contains `revision`, `health` (`healthy` or `faulted`), `editingEnabled`, `busy`, `canUndo` and `canRedo`. Revisions are opaque and instance-local. Document changes advance the revision; selection, zoom and pan do not. External save success confirms only its snapshot revision, so a delayed acknowledgment must not clear later edits. Undo may conservatively produce a new dirty revision even when content matches an earlier save.

Invalid imports preserve the document. An unfinished gesture or text edit reports `EditorBusy`; operations do not silently cancel input. A failed local transaction may report `faulted` with `revision: null`, blocking snapshots and further changes until an explicit successful replacement restores the instance. External save failures are host errors and do not fault the runtime.

## Snapshots and PNG documents

```javascript
const snapshot = await editor.exportSnapshot({
  formats: ["png"],
  render: { scale: 2, maxWidth: 1920, padding: 10 },
  png: { embedDocument: true },
});
await writeFile(snapshot.png.base64, snapshot.revision);
```

Choose distinct formats: `raw`, `png`, `svg`. Raw-only export does not render. Render defaults are `scale: 1` and `padding: 10`, with no product width limit. PNG contains `base64`, pixel `width/height`, `scale`, and logical `displayWidth/displayHeight`. SVG is a logical-coordinate string; `render.roundSvgNumbers` optionally rounds its numbers.

`png.embedDocument` defaults to false. When true, WASM inserts the editable document into the PNG from the same snapshot; hosts write the complete image without implementing chunks or CRC. PNG options require the PNG format. `replacePngDocument` rejects ordinary PNGs without embedded documents and damaged images without clearing the current diagram.

## Buttons and host actions

`ui.buttons` overrides built-in visibility. IDs are `undo`, `redo`, `arrow`, `rectangle`, `ellipse`, `diamond`, `text`, `sketchyMode`, `zoomIn`, `zoomOut`, `resetZoom`, `settings`, and `help`. All default visible except `help`. Visibility does not revoke editing permission or disable JS operations.

Declare product actions in order through `ui.actions`. IDs use the `host.` namespace, labels are text, and icons use existing icon names. Actions default visible and enabled; Save, Publish, accounts and product buttons are not built in.

```javascript
const editor = await createEditor({
  container, assetBaseUrl: runtimeUrl,
  ui: { actions: [{
    id: "host.save", label: "Save", icon: "save",
    async onInvoke({ editor, signal }) {
      const snapshot = await editor.exportSnapshot({ formats: ["png"], png: { embedDocument: true } });
      await saveAndConfirm(snapshot, signal);
    },
  }] },
});
```

Handlers stay in the parent. Independent reverse RPC lets a handler export, update action state or dispose without holding the document queue. The runtime prevents repeated pending clicks and shows structured errors. Disposal/page exit cancels the handler signal without waiting for it; cancellation does not undo an external write. Unknown options, duplicate action IDs and missing handlers fail creation.

## Isolation, modules and lifecycle

One iframe isolates CSS, DOM and .NET globals; it is not an additional security sandbox or guaranteed process. A one-time bootstrap verifies the exact HTTP(S) runtime origin and iframe source, binds the URL nonce, and transfers a private `MessagePort`. All operations/state/actions then use protocol v2 on the port. The parent origin is not parsed, allowing a VS Code webview to host the SDK directly. The SDK is one browser module; SSR import is supported, while creation needs browser DOM, cryptographic random IDs and `MessageChannel`.

`modules.analytics`, `authentication` and `remoteSync` default false and freeze before Blazor starts. The public build omits optional implementations; enabling absent modules fails explicitly. Full website builds may enable included modules. Remote sync requires authentication; disabled sync preserves local document/history operations.

Startup cancellation uses `signal`; `startupTimeoutMs` defaults to 120000. After creation, explicit disposal owns the instance. `requestTimeoutMs` also defaults to 120000. An operation deadline throws `EditorError` with `code: RequestTimeoutUnknown`, `requestId`, `method`, and a `completion` promise. The frame/document remain available; no retry occurs and the late result retains its ID.

```javascript
try {
  await editor.replaceDocument(raw);
} catch (error) {
  if (error.code === "RequestTimeoutUnknown") {
    const { result, error: eventualError } = await error.completion;
    // Reconcile the eventual outcome; never automatically retry a mutation.
  } else throw error;
}
```

`completion` resolves to `{ result }` or `{ error }`, including disposal before a response. Runtime errors retain `{ code, message }` on `EditorError`. Idempotent dispose is bounded by `disposeTimeoutMs` (default 5000), rejects pending work, cancels actions and removes the iframe. Missing cleanup acknowledgment rejects `DisposeCleanupUnconfirmed`; removal still completes. Page exit cleanup is best effort.

## Verification and release

Tooling requires Node.js 22+. Current Chromium is the verified visual-runtime target. CI declares Linux/Windows/macOS packaging; actual platform, mobile, Firefox/WebKit, VS Code and Forge checks must be reported separately. There is no Node/Worker visual editor.

```bash
npm ci
npm test
npm run build
npm run assets:verify
npm run audit:package
npx playwright install chromium
npm run test:browser
npm pack
```

Assets carry package version, exact committed producer and hashes. Native assets are rebuilt for each release; source, symbols, maps and embedded debug metadata are excluded. Package, wire protocol and document format have separate version contracts.

## License

MIT. Bundled dependencies and fonts retain notices. See [NOTICE](NOTICE), [Contributing](CONTRIBUTING.md), [Changelog](CHANGELOG.md) and [Security reporting](SECURITY.md).
