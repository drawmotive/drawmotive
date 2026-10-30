# Editor SDK guide and API reference

This guide covers the public standalone `@drawmotive/editor` SDK: mounting, configurable UI, local documents, semantic editing functions, events, browser services and lifecycle. Authentication, analytics, business requests and private site synchronization belong to the embedding application. There is no public synchronization API or `sendCommand` API.

**Architecture:** one active canvas is supported per page. Blazor mounts directly in the host DOM and persists for the page lifetime. Each opened document has a fresh native scope. This branch is a staging candidate; npm publication remains separate.

The generated scene APIs require the matching native runtime built from the companion source revision. The diagrams site builds that committed-source candidate without publishing npm packages. Previously committed generated release assets retain their own producer and are not validation evidence for these new APIs.

The authoritative declarations are [core.d.ts](../src/core.d.ts), [UI options](../src/react/ui-options.ts) and [React props](../src/react/index.d.ts). Only package export paths listed below are supported imports.

## Contents

- [Entry points and installation](#entry-points-and-installation)
- [Mounting recipes](#mounting-recipes)
- [Creation options](#creation-options)
- [UI configuration](#ui-configuration)
- [Document and snapshot API](#document-and-snapshot-api)
- [Selection and editing API](#selection-and-editing-api)
- [Text editing](#text-editing)
- [Clipboard recipes](#clipboard-recipes)
- [State, events and host actions](#state-events-and-host-actions)
- [Preferences, fonts and Workers](#preferences-fonts-and-workers)
- [Errors and lifecycle](#errors-and-lifecycle)
- [How JS interoperates with the engine](#how-js-interoperates-with-the-engine)
- [Integration checklist](#integration-checklist)

## Entry points and installation

| Import | Exports / behavior | Appropriate host |
| --- | --- | --- |
| `@drawmotive/editor` | `createEditor`, `EditorError`; mounts the runtime and configured React/Mantine UI | Vanilla JS or another framework needing ready-made editor controls |
| `@drawmotive/editor/browser` | Alias of the full entry | Explicit browser imports |
| `@drawmotive/editor/core` | `createEditor`, `EditorError`; mounts only the runtime, without loading React UI | Custom controls, minimal canvas or separately mounted SDK UI |
| `@drawmotive/editor/react` | `Editor`, `EditorUi`, `mountEditorUi` and React/UI types | React 19 hosts |
| `@drawmotive/editor/styles.css` | Packaged editor UI stylesheet | Full entry and React UI |

The full imperative entry bundles its UI's React runtime. The React entry shares the host's React 19 installation. The core entry loads no React UI; native inline text input and grips still belong to the canvas. There is no Node.js or Worker visual-editor entry.

For a matching released package:

```bash
npm install @drawmotive/editor
npx drawmotive-copy-assets public/editor
```

For a React host, also install compatible React peers:

```bash
npm install react@19 react-dom@19
```

Copy the complete runtime again after every package upgrade. A Vite host can include these lifecycle scripts in its package.json:

```json
{
  "scripts": {
    "predev": "drawmotive-copy-assets public/editor",
    "dev": "vite",
    "prebuild": "drawmotive-copy-assets public/editor",
    "build": "vite build"
  }
}
```

Serve assets over HTTP(S), with `.wasm` served as `application/wasm`. Use a secure browser context, such as HTTPS or localhost, for browser storage and clipboard capabilities. A static host is sufficient; a login session and DrawMotive server are not prerequisites.

`assetBaseUrl` selects the runtime/font asset base. Bundled hosts should always supply it, including any deployment subpath. Document/resource Worker URLs are resolved from the package modules by default; the asset-copy command copies the generated runtime, not a separately relocated copy of `dist/workers`. See [Worker relocation](#worker-relocation).

## Mounting recipes

### Full UI in a non-React application

Give the container a nonzero height before mounting. Keep the instance for later commands and dispose it when the host view closes.

```html
<div id="diagram" style="position: relative; width: 100%; height: 600px"></div>
```

```javascript
import { createEditor } from '@drawmotive/editor';
import '@drawmotive/editor/styles.css';

const container = document.getElementById('diagram');
if (!container) throw new Error('Editor container is missing.');

const editor = await createEditor({
  container,
  assetBaseUrl: '/editor/',
  persistence: { mode: 'memory' },
});
await editor.replaceTextGraph('Start -> Finish');
await editor.fitViewport();

// Run when the host view closes.
// await editor.dispose();
```

`createEditor()` resolves after runtime readiness, including initial document/resource preparation. Full-entry UI mounting follows that readiness; the promise is not a browser-paint or screenshot barrier.

### React with local persistence and a host slot

```tsx
import { useMemo } from 'react';
import type { EditorCreateOptions, EditorUiOptions } from '@drawmotive/editor';
import { Editor } from '@drawmotive/editor/react';
import '@drawmotive/editor/styles.css';

export function Diagram({ documentId }: { documentId: string }) {
  const persistence = useMemo<EditorCreateOptions['persistence']>(() => ({
    mode: 'persistent', namespace: 'local-diagrams', documentId,
  }), [documentId]);
  const ui = useMemo<EditorUiOptions>(() => ({
    regions: { topRight: { items: ['slot.documentName'] } },
    drawingToolbar: { position: 'left', tools: ['rectangle', 'arrow', 'text'] },
  }), []);

  return <Editor
    assetBaseUrl="/editor/"
    persistence={persistence}
    ui={ui}
    slots={{ documentName: <span>{documentId}</span> }}
    style={{ height: 600 }}
    onError={error => console.error(error)}
  />;
}
```

`slot.documentName` reads `slots.documentName`; React elements remain in the host and never cross the runtime port. The component owns creation and disposal. `onReady(editor)` supplies the instance for application commands. Handle asynchronous work started in `onReady` yourself; the callback is not an awaited initialization hook.

Memoize object/function creation options. Changes to `assetBaseUrl`, `ui`, `persistence`, `workerFactory`, `workerUrls`, `signal`, `title` or deadline props recreate the runtime, including reference changes to object values. Changing `slots`, `colorScheme`, `className`, `style` or callbacks updates the React layer. Cleanup waits for the previous writer to be released before starting a successor.

### Minimal canvas, custom controls or read-only preview

```javascript
import { createEditor } from '@drawmotive/editor/core';

const editor = await createEditor({
  container,
  assetBaseUrl: '/editor/',
  ui: { enabled: false, textEditing: 'disabled' },
});
await editor.replaceDocument(raw);
await editor.fitViewport();
```

Here `container` and `raw` are host-provided values. This configuration removes toolbars and inline text input while retaining canvas manipulation, selection feedback and grips. To retain DContentEditable, use `ui: false` or `textEditing: 'inline'` instead. For a read-only preview, also call `await editor.setEditingEnabled(false)` after loading. Hiding UI does not disable editing. Editing-disabled mode blocks user mutations and Undo/Redo; host loading, document replacement and export remain available. It is not an authorization boundary.

The core entry can retain enabled UI descriptors for a later `EditorUi` mount. It never mounts controls by itself. A React host can render `<EditorUi editor={editor} container={container} />` for that existing instance. The container must own its canvas and provide the overlay positioning context. The host still owns disposal of the core instance.

`mountEditorUi({ editor, container, slots?, colorScheme?, className?, style?, onError? })` is the imperative equivalent and returns `{ dispose(): void }`. Its disposer removes only that UI mount. Mount one UI owner per instance; the full entry already mounts one. `EditorUi` takes the same props and observes the instance without creating another runtime.

### Reopen a local document or switch documents

Persistent mode uses the pair `(namespace, documentId)` on the browser origin. Recreate an editor with the same pair to reopen it. Do not call `replaceTextGraph`, `replaceDocument` or `clearDocument` on every mount, because those calls replace the stored document.

One runtime owns one logical document. Switching to another document means awaiting `dispose()` and creating another instance with a new identity. A persistent document has one writer lease across tabs/instances; a second concurrent writer fails with `StorageConflict`, including a second editing-disabled instance. Use a separate memory instance populated from a snapshot when an independent preview is needed.

`namespace` is an opaque local partition, not a credential. Supply an account-specific namespace from an authenticated App when necessary, then dispose the old instance on account changes. There is no public database/table API, local-document listing API or delete-from-database API. `clearDocument()` creates an empty document under the same identity; it does not delete its storage record.

## Creation options

All three creation styles use `EditorCreateOptions`; `Editor` supplies `container` internally. Unknown keys and invalid values are rejected.

| Option | Value / default | Purpose |
| --- | --- | --- |
| `container` | Required `HTMLElement` for imperative creation | Owns the canvas and UI |
| `assetBaseUrl` | HTTP(S) string or URL; defaults relative to the SDK's generated assets | Runtime and font resource base; supply explicitly in bundles |
| `title` | `DrawMotive diagram editor` | Accessible canvas label |
| `ui` | `EditorUiOptions` or `false`; enabled by default | UI and text-input policy |
| `persistence` | Defaults to `{ mode: 'memory' }` | Temporary document or persistent identity |
| `workerFactory` | Optional `(url, options?) => Promise<{ worker, dispose() }>` | Host-specific Worker construction and cleanup |
| `workerUrls` | Optional `{ document?: string \| URL, resource?: string \| URL }` | Relocate the two self-contained packaged Workers |
| `signal` | Optional `AbortSignal` | Cancel creation; does not cancel later editor commands |
| `startupTimeoutMs` | `120000`, finite and positive | Runtime initialization deadline |
| `disposeTimeoutMs` | `5000`, finite and positive | Explicit disposal cleanup deadline |

Persistence configuration is either `{ mode: 'memory', namespace?, documentId? }` or `{ mode: 'persistent', namespace, documentId }`. Persistent identities must be nonempty strings. Memory mode keeps the document temporary, but fonts may still use OPFS and preferences still use localStorage.

## UI configuration

UI configuration is fixed at creation apart from declared host-action state. Changing the configuration in React recreates the instance; there is no public `setUi` function. `editor.ui` returns the normalized read-only descriptor, without action functions.

| Field | Default / accepted values |
| --- | --- |
| `enabled` | `true`; `false` hides all React chrome |
| `buttons` | Map of built-in IDs to booleans; all visible except `help` |
| `actions` | Ordered host-action declarations; empty by default |
| `regions` | Four independently configured corners |
| `drawingToolbar` | Visible, `position: 'left'`, tools `arrow`, `rectangle`, `ellipse`, `diamond`, `text` |
| `contextToolbar` | Visible; supported object/tool/panel lists unrestricted |
| `textEditing` | `inline`; also `external` or `disabled`, independent of chrome visibility |
| `tooltip` | Visible, `position: 'top'`, `delay: 250` milliseconds |

### Corners, buttons and drawing toolbar

Each region accepts a boolean or `{ visible?, items? }`; items preserve order. Empty regions do not render.

| Region | Default items |
| --- | --- |
| `topLeft` | `undo`, `redo` |
| `topRight` | `help`, followed by host actions not explicitly assigned to another region |
| `bottomLeft` | Empty |
| `bottomRight` | `sketchyMode`, `zoomOut`, `resetZoom`, `zoomIn`, `settings` |

Built-in button IDs: `undo`, `redo`, `arrow`, `rectangle`, `ellipse`, `diamond`, `text`, `sketchyMode`, `zoomIn`, `zoomOut`, `resetZoom`, `settings`, `help`. Region items can also reference declared `host.*` actions or `slot.*` React slots. `host.` and `slot.` require a nonempty identifier beginning with a letter or digit; subsequent characters may include letters, digits, dots, underscores and hyphens.

`drawingToolbar` accepts a boolean or `{ visible?, position?, tools? }`. Positions are `left`, `right`, `top`, `bottom`; tool IDs are `arrow`, `rectangle`, `ellipse`, `diamond`, `text`, `sketchyMode`. `select` is a semantic `setTool` value, not a configurable built-in toolbar button. Lists reject duplicate IDs.

```javascript
const ui = {
  regions: {
    topLeft: { items: ['undo', 'redo'] },
    topRight: false,
    bottomLeft: false,
    bottomRight: { items: ['zoomOut', 'resetZoom', 'zoomIn'] },
  },
  drawingToolbar: { position: 'top', tools: ['rectangle', 'arrow'] },
  contextToolbar: false,
  textEditing: 'inline',
  tooltip: { position: 'bottom', delay: 150 },
};
```

Button visibility is global for that built-in ID. Omitting a control does not revoke the corresponding API capability. Settings/help are SDK controls; login, accounts, Save and Publish are host workflows. Shortcut hints describe commands; complete keyboard binding migration remains pending in this draft and should not be inferred from a visible hint.

### ContextToolbar and tooltip

`contextToolbar` accepts a boolean or `{ visible?, objectTypes?, tools?, panels? }`. Omitted lists include supported entries; an empty list selects none. Entries also depend on current selection capabilities and interaction state. Unknown filter strings do not create new controls.

| Filter | Supported IDs |
| --- | --- |
| `objectTypes` | `Shape`, `Line`, `Group`, `IndependentText`, `BoundText` |
| `tools` | `strokeFillColor`, `strokeColor`, `strokeStyle`, `cornerRadius`, `editText`, `textSizeSmall`, `textSizeMedium`, `textSizeLarge`, `bold`, `italic`, `textAlign`, `lineStartStyle`, `lineEndStyle`, `swapLineEndpoints`, `lineRouting`, `lineAttachment`, `groupTheme`, `groupTitleStyle`, `moreOptions` |
| `panels` | `strokeFillColor`, `strokeColor`, `strokeStyle`, `textAlign`, `lineStartStyle`, `lineEndStyle`, `lineRouting`, `lineAttachment`, `groupTitleStyle`, `moreOptions` |

Filtering out a panel also removes its launcher. Mixed selections must support an operation across all effective subjects. Bound-label focus uses its text capabilities. `strokeFillColor` retains the overlaid fill/stroke icons; `groupTheme` is an inline control rather than an entry in the panel list. The ContextToolbar is suppressed during busy interactions.

`tooltip` accepts a boolean or `{ visible?, position?, delay? }`. Position is `top`, `bottom`, `left` or `right`; delay is finite and nonnegative. The SDK retains the distinctive separated arrow/body appearance. These options control visibility and placement, not an arbitrary tooltip-rendering callback.

## Document and snapshot API

Unless stated otherwise, commands return promises. Await dependent operations. Raw documents, selection payloads and revision strings are opaque.

| Function | Result and semantics |
| --- | --- |
| `replaceDocument(raw: string)` | Validates an editable base64 document, replaces content and resets selection/history |
| `replacePngDocument(base64: string)` | Opens a PNG containing an embedded editable document; pass bare base64, not a data URL |
| `replaceTextGraph(source: string)` | Compiles TextGraph into a replacement document |
| `clearDocument()` | Replaces with an empty document and resets history |
| `retryPersistence()` | Explicitly confirms/retries a retained identical local storage batch after an uncertain receipt; does not repeat the edit |
| `exportSnapshot(options)` | Returns `EditorSnapshot` containing requested formats from one revision |
| `fitViewport(options?)` | Fits document content without changing its revision |
| `setEditingEnabled(enabled: boolean)` | Controls user edits and JS history operations |
| `undo()` / `redo()` | Applies local history; revisions may advance |
| `setTool(tool)` | Activates `select`, `arrow`, `rectangle`, `ellipse`, `diamond` or `text` |
| `zoom(direction)` | Display-only `in`, `out` or `reset` |
| `setSketchyMode(enabled: boolean)` | Changes document sketch appearance through an undoable transaction |

Invalid imports preserve the current document. Operations requiring an idle document reject unfinished gestures/text input rather than silently cancelling them. TextGraph-to-canvas is one-way: canvas edits do not rewrite TextGraph source; calling `replaceTextGraph()` again replaces prior edits. There is no public incremental TextGraph merge or mutable scene-object API.

### Export options and return values

```javascript
const snapshot = await editor.exportSnapshot({
  formats: ['raw', 'png', 'svg'],
  png: { embedDocument: true },
  render: { scale: 2, maxWidth: 1920, padding: 10, roundSvgNumbers: true },
});
```

| Option | Meaning |
| --- | --- |
| `formats` | Required nonempty list of distinct `raw`, `png`, `svg` |
| `png.embedDocument` | Default `false`; embed the editable document in the PNG from this same revision |
| `render.scale` | Default `1`; finite, positive requested raster scale |
| `render.maxWidth` | Optional finite, positive width limit |
| `render.padding` | Default `10`; finite, nonnegative padding |
| `render.roundSvgNumbers` | Optional boolean controlling SVG number rounding |

PNG options require `png` in `formats`. Raw-only export does not render. The result always includes `revision`; requested outputs are `raw` (base64 string), `svg` (string), and `png` (`{ base64, width, height, scale, displayWidth, displayHeight }`). Unrequested outputs may be null or absent. PNG dimensions are pixels; display dimensions are logical dimensions. Use returned scale/dimensions rather than assuming an uncapped render size.

For download, prepend `data:image/png;base64,` to `snapshot.png.base64`. For reopening, pass `snapshot.png.base64` to `replacePngDocument`. Ordinary PNG images without the embedded document are rejected; this is not an image-placement API. Hosts write the complete exported bytes without implementing PNG metadata chunks themselves.

`fitViewport({ padding?, minScale?, maxScale? })` defaults to `60`, `0.2`, `1`; padding must be nonnegative and scales positive with `minScale <= maxScale`. It adjusts only the view.

### Saving and dirty state

Local persistence and external saving are separate. Persistent mode commits local editing data automatically; a host file or server save starts with an exported snapshot. Confirm the snapshot's revision only after the external write succeeds.

```javascript
let lastSavedRevision = null;
let saving = false;

async function save(editor, writeSnapshot) {
  if (saving) return;
  saving = true;
  try {
    const snapshot = await editor.exportSnapshot({ formats: ['raw'] });
    await writeSnapshot(snapshot); // Host-owned storage; reject on failure.
    lastSavedRevision = snapshot.revision;
    const current = await editor.getState();
    return current.health === 'healthy' && current.revision === lastSavedRevision;
  } finally {
    saving = false;
  }
}
```

The boolean reports whether that exact saved revision is still current. Edits may occur while the write is pending, so a successful write need not make the editor clean. Track revisions per instance/document, serialize external writes per document, and re-evaluate dirty UI from state changes. Do not compare revision strings across instances or parse their contents. Undo can conservatively produce a new revision even when content resembles an earlier save. A debounced autosave should respect `busy`, retain failed saves, and schedule the latest dirty revision after an in-flight save; it must not clear newer edits on an older acknowledgment.

## Generated scene model and batch editing

The document API exposes generated values from scene metadata and every live graphics item's persisted model. It does not maintain a separate command or DTO for each property. Native model additions appear in the model and schema automatically; runtime services, caches and CRDT clocks are excluded.

| Function | Result / arguments |
| --- | --- |
| `getScene()` | `Promise<EditorSceneSnapshot>`: revision, metadata and all live items |
| `editScene(edit)` | Validates and commits one batch as one document transaction and one Undo step |
| `getSelection()` | `Promise<EditorSelectionSnapshot>`: observed revision, selection token, selected items and screen anchor |
| `deleteSelection(token)` | Deletes the validated selection through the engine |
| `beginTextEditing(targetItemId?)` | Begins text input for an explicit item or the selected target |
| `applyText(token, targetItemId, content)` | Commits host-supplied text without entering inline input |
| `copySelection(token)` | Returns opaque `{ version: 1, data: string }` |
| `pasteSelection(payload, { x, y })` | Clones/remaps the opaque graph through the engine; returns the pasted selection |

### Discover objects, properties and operations

`getScene()` returns `{ revision, metadata: { type, model, schema }, items: [{ id, type, model, schema }] }`. Each `model` is a detached JSON object, not a mutable reference to the C# object. SDK results are deeply immutable. Modifying a snapshot never edits the document; call `editScene` to commit changes.

A schema contains `type`, `properties` and `operations`. Each property describes `name`, `kind`, `writable`, `nullable`, optional enum `values` and optional nested `properties`. Operation descriptors contain the generated camel-case `name` and ordered parameter names. Use these descriptors to build an inspector without an SDK property whitelist.

```javascript
const scene = await editor.getScene();
console.log(scene.metadata.model.title, scene.metadata.schema.properties);
for (const item of scene.items) {
  console.log(item.id, item.type, item.model, item.schema.operations);
}
```

Property names use camel case. Enums use native names, such as `"Solid"` or `"Orthogonal"`. Signed and unsigned 64-bit integers use decimal strings to preserve precision. Colors use numeric unsigned ARGB values; vectors use `{ x, y }`. Arrays are replaced as a complete leaf value. A nested tracked object is patched through its existing children, preserving their identity. Unsupported value types and lifecycle-sensitive state remain readable where possible and explicitly read-only. Read the schema before building generic controls: IDs, ownership, tombstones, group membership and derived routing geometry are not ordinary writable properties.

### Batch contract

`editScene` accepts `{ revision, description, changes, token? }`. Every change has a `path: string[]` and optional `itemId`. Omitting `itemId` targets scene metadata; providing an ID targets any existing live item, including one outside the current selection.

| Operation | Shape |
| --- | --- |
| Set a property | `{ itemId?, path, value, op?: 'set' }` |
| Remove a dictionary entry | `{ itemId?, path, op: 'remove' }` |
| Call an advertised model operation | `{ itemId?, path: [operationName], op: 'call', arguments: [...] }` |

The complete batch is validated against detached staged targets before any live mutation, then checked again under the transaction lock. Invalid paths, types, enum values, read-only writes or operation arguments reject the whole batch. No partial edits, history entry or document clock update is produced by a validation rejection. C# owns tracked setters, history, text measurement, spatial indexes, grips, connector routing and repaint. JavaScript sends one request for the entire edit; it does not hold a native transaction open across calls.

Use the opaque `revision` from the snapshot that produced your edit. `StaleRevision` rejects outdated values or edits for a replaced document. After an edit, obtain a fresh scene or selection before preparing the next dependent batch. Do not parse revisions or silently retry an edit against a newer document. A `token` is optional; selection-based controls should supply the token they displayed to reject reselection with `StaleSelection`. `EditorBusy` means an active interaction must finish first. Structured errors remain `EditorError` values. Uncertain persistence retains the explicit fault/retry behavior described above; validation guarantees do not promise storage rollback after an unknown durable receipt.

### Change scene metadata and several objects together

```javascript
const scene = await editor.getScene();
const item = scene.items.find(item => item.id === targetItemId);
if (!item) throw new Error('The target item is unavailable.');
await editor.editScene({
  revision: scene.revision,
  description: 'Move object and update diagram',
  changes: [
    { itemId: item.id, path: ['data', 'transformation', 'translation'], value: { x: 200, y: 120 } },
    { itemId: item.id, path: ['xData', 'custom:label'], value: 'Reviewed' },
    { path: ['title'], value: 'Architecture overview' },
    { path: ['style'], value: 1 }, // 0: normal; 1: sketchy
  ],
});
```

A direct property edit changes the persisted value. For domain operations, use an advertised model method: a group's `setTranslation({ x, y })` also moves its descendants, while changing `data.transformation.translation` changes the group's frame. Connector waypoints and routed endpoints are derived output; move a line through its canonical attachments or advertised operations. Method availability is discovered from the object's schema.

### Style a validated selection

```javascript
const selection = await editor.getSelection();
const shapes = selection.items.filter(item => item.capabilities.fill);
if (shapes.length) {
  await editor.editScene({
    revision: selection.revision,
    token: selection.token,
    description: 'Change fill color',
    changes: shapes.flatMap(item => [
      { itemId: item.id, path: ['data', 'paintStyle', 'fillColor', 'colorClass'], value: 'PrimaryFill' },
      { itemId: item.id, path: ['data', 'paintStyle', 'fillColor', 'colorValue'], value: null },
    ]),
  });
}
```

Clear the explicit `colorValue` when choosing a theme role. Likewise, `widthValue: null` and `sizeValue: null` restore theme-derived width and font size. An explicit ARGB color or numeric width/size can be set through the same generated graph.

### Use model operations and dictionaries

```javascript
const scene = await editor.getScene();
const group = scene.items.find(item => item.id === groupId);
if (group?.schema.operations.some(operation => operation.name === 'resetTitleStyle')) {
  await editor.editScene({
    revision: scene.revision,
    description: 'Restore title and remove annotation',
    changes: [
      { itemId: group.id, op: 'call', path: ['resetTitleStyle'], arguments: ['All'] },
      { itemId: group.id, op: 'remove', path: ['xData', 'custom:label'] },
    ],
  });
}
```

Existing model operations include group `setThemeColorRole(roleOrNull)`, `setHeaderVisible(booleanOrNull)`, `resetStyle(property)` and `resetTitleStyle(property)`; connector `setRoutingMode(mode)`, `setEndpointBoundary(start, boundaryId)` and `disconnectStart()`/`disconnectEnd()`; and supported item `toggleCornerRadius()`/`setTranslation(position)`. Pass all declared arguments, including explicit nulls. Group style reset values are `All`, `Border`, `Body`, `Line`, `Corners`, `Opacity` and `Header`. Title reset values are `All`, `Color`, `Size`, `Weight`, `Slant` and `Alignment`.

Endpoint styles use integers `0` none, `1` simple arrow, `2` filled arrow, `3` open arrow, `4` circle and `5` diamond. Endpoint boundary operations retain the current owner and accept IDs advertised in that endpoint's `boundaryIds`; they are not a general connect-to-any-object API.

### Selection observations

`EditorSelectionSnapshot` contains `revision`, `token`, `items` and nullable `anchor`. A token contains opaque `session` and numeric `version`; reselection can invalidate it even when the IDs are unchanged. Keep the token associated with the control shown to the user.

Each selected item exposes its generated `model`, small `resolved` presentation values, `id`, `kind`, `bindingItemId`, `textId`, `screenBounds`, capabilities and optional `text`/`boundText`/`startAttachment`/`endAttachment`. Kinds are `Shape`, `Line`, `Group`, `IndependentText` and `BoundText`. Capabilities report `stroke`, `fill`, `cornerRadius`, `editText`, `text`, `verticalTextAlignment`, `line`, `connectorRouting`, `group` and `groupTitle`. `resolved` contains the effective corner radius, generated effective font style for text, and group theme/header values where applicable. Mixed-value aggregation belongs to the UI; the public scene API has no property-specific aggregate DTO.

Attachment observations contain `{ attachment: { kind, ownerId, boundaryId }, boundaryIds, unresolved }`. `routingUnavailable` reports unresolved routing failure. Screen anchors remain native observations, so custom controls do not need to reconstruct canvas geometry.

### Coordinates

Paste positions are **drawing/model coordinates**, with X right and Y down. `screenBounds`, selection `anchor` and text-edit-intent bounds are **canvas-local CSS screen coordinates**, also Y down. They are not page coordinates and are not directly usable as paste positions. A custom overlay must account for canvas/host offsets and CSS transforms. The SDK currently has no exported page-to-model conversion helper; do not pass raw `clientX/clientY` to paste.

## Text editing

| `ui.textEditing` | Behavior |
| --- | --- |
| `inline` | Default; DContentEditable handles browser text input/IME inside the canvas |
| `external` | Emits `textEditingRequested`; the host supplies its own form and submits through `applyText` |
| `disabled` | Disables initiating text input; does not disable every document command |

All policies work independently of toolbar visibility. Existing text still renders. The SDK keeps native inline input to avoid requiring an external rich-text component.

For external input, `textEditingRequested` supplies `{ targetItemId, textId, content, screenBounds }`. `textId` may be null for new bound text or a new detached placement. Use `targetItemId` exactly as supplied; obtain and retain the selection token for that interaction. The following assumes `openTextForm` is a host-owned form returning a string or `null` for cancellation, and `reportError` is host error UI:

```javascript
const stopText = editor.onEvent('textEditingRequested', intent => {
  void (async () => {
    const selection = await editor.getSelection();
    const content = await openTextForm(intent.content);
    if (content !== null && editor.lifecycle === 'ready') {
      await editor.applyText(selection.token, intent.targetItemId, content);
    }
  })().catch(reportError);
});
```

Prevent overlapping forms and close them when the instance closes or the target becomes invalid. Handle `StaleSelection`/`InvalidTarget` by asking the user to select or reopen the target. Closing the form without `applyText` leaves existing content unchanged. Empty text can discard a new detached placement. There is no public generic inline commit/cancel method; the inline DOM owns that interaction.

## Clipboard recipes

`copySelection`/`pasteSelection` exchange an opaque selection graph through explicit function arguments. They do not touch the OS clipboard. This is useful for host-controlled transfer between instances:

```javascript
const selection = await sourceEditor.getSelection();
const payload = await sourceEditor.copySelection(selection.token);
await destinationEditor.pasteSelection(payload, { x: 120, y: 80 });
```

C# owns object cloning, ID/reference remapping, bound labels, connectors and the paste transaction. JS must not decode or alter the graph to recreate these semantics.

| Function | Behavior |
| --- | --- |
| `copyToClipboard(token, { system? })` | Always updates the instance-local internal buffer on successful graph capture; `system` defaults to `true` |
| `pasteFromClipboard({ x, y }, { source? })` | `source` is `auto` (default), `system` or `internal` |

Copy returns `{ internal: true, system: 'written' \| 'denied' \| 'unavailable' \| 'skipped' }`. A denied system write can still leave a successful internal copy. The internal buffer is per instance, survives neither disposal nor reload, and is not a document snapshot.

`internal` never reads the system clipboard. `system` requires a successful system read and a recognized DrawMotive selection. `auto` tries the system first and uses the internal buffer when system access is unavailable/denied. A successful read of unrelated text reports `ClipboardFormatUnsupported`; it never resurrects an older internal copy. Arbitrary text/image paste is not implemented by these selection APIs.

Invoke system operations directly from a browser user gesture. Keep the current token from selection notifications so that you do not await another operation before initiating privileged clipboard access:

```javascript
let currentSelection;
const stopSelection = editor.onEvent('selectionChanged', value => { currentSelection = value; });
const initialSelection = await editor.getSelection();
currentSelection ??= initialSelection;

copyButton.addEventListener('click', () => {
  void editor.copyToClipboard(currentSelection.token).catch(reportError);
});
pasteButton.addEventListener('click', () => {
  void editor.pasteFromClipboard({ x: 120, y: 80 }, { source: 'system' }).catch(reportError);
});
```

Here `copyButton`, `pasteButton` and `reportError` belong to the host. The helper starts a promise-backed `ClipboardItem` write during the gesture where supported; browser permissions and fallback behavior still vary. In-app copy/paste can explicitly use `{ system: false }` and `{ source: 'internal' }`. Full native shortcut/clipboard integration remains an acceptance item for this draft.

## State, events and host actions

### State and subscriptions

| Member | Contract |
| --- | --- |
| `lifecycle` | Read-only `ready`, `disposing`, `disposed` |
| `ui` | Current normalized UI descriptor |
| `getState()` | Promise of current `EditorState` |
| `onStateChanged(listener)` | Immediate replay of known state, then changes |
| `onUiChanged(listener)` | Immediate replay, then descriptor changes from host-action updates |
| `onPreferencesChanged(listener)` | Replays a known value if available, then successful runtime changes |
| `onDisposed(listener)` | Called once at closure; immediately if already disposed |
| `onEvent(name, listener)` | Event subscription; no immediate replay |

Each subscription returns an unsubscribe function. Event callbacks are synchronous notifications; catch failures from asynchronous work you start inside them.

`EditorState` includes `revision: string | null`, `health: 'healthy' | 'faulted'`, `editingEnabled`, `busy`, `canUndo`, `canRedo`, and optional `tool`, `zoom`, `sketchyMode`. Use these values to enable controls; the engine remains authoritative when a command arrives. Selection/zoom/pan do not advance the document revision.

Public `onEvent` names are:

| Name | Payload / initialization |
| --- | --- |
| `selectionChanged` | `EditorSelectionSnapshot`; use `getSelection()` for the initial value |
| `textEditingRequested` | `EditorTextEditIntent`; external text-input intent |
| `fontCacheStatus` | `{ path, cache, detail? }`; use `getFontCacheStatus()` for startup results |

For an initial read alongside a subscription, do not let an older read overwrite a newer event. The pattern below tracks notifications while the initial request is pending:

```javascript
let notifications = 0;
const stop = editor.onEvent('selectionChanged', value => {
  notifications++;
  renderSelection(value); // Host UI.
});
const initial = await editor.getSelection();
if (notifications === 0) renderSelection(initial);
```

### Host actions

```javascript
const editor = await createEditor({
  container,
  assetBaseUrl: '/editor/',
  ui: {
    actions: [{
      id: 'host.save', label: 'Save', icon: 'save',
      async onInvoke({ editor, signal }) {
        const snapshot = await editor.exportSnapshot({
          formats: ['png'], png: { embedDocument: true },
        });
        await writeSnapshot(snapshot, signal); // Host-owned write and acknowledgment.
      },
    }],
    regions: { topRight: { items: ['host.save'] } },
  },
});
```

Here `createEditor` is the full entry and `writeSnapshot` is host-provided. An action requires `id: 'host.…'`, a nonempty text `label` and `onInvoke`. Optional `enabled` and `visible` default to true; `icon` names an existing SDK icon, not arbitrary markup or a component. Omit it for a text-only action. Functions stay in the host and do not cross the port. Duplicate IDs, undeclared action references and missing handlers fail validation.

`await editor.invokeAction(id)` invokes a declared available action. `await editor.setActionState(id, { label?, enabled?, visible? })` updates its descriptor in the host; it is not a C# document mutation. Unknown actions are rejected. The supplied SDK controls suppress repeated pending clicks; direct programmatic invocation is not a global action mutex, so serialize business writes in the host.

The handler may export, update action state or dispose the editor. Its `signal` is aborted on disposal/page closure; the host must observe cancellation, and cancellation cannot undo an external write. A rejected host save does not itself fault the canvas. When implementing dirty/save state, use the revision rules above.

## Preferences, fonts and Workers

### Preferences and themes

`await editor.getPreferences()` returns `{ darkTheme?, showGrid?, snapToGrid? }`. `await editor.setPreferences(partial)` accepts those boolean fields and persists the successful update through host-side localStorage. Unknown fields are rejected. `onPreferencesChanged` reflects authoritative successful updates; use an initial `getPreferences()` when no value has been observed.

Preferences are origin-wide editor preferences, not per-account or document data. Each live runtime has its own applied state; do not assume automatic cross-tab propagation. `colorScheme` on React UI controls the chrome's light/dark appearance; set `darkTheme` through the instance when changing the canvas theme too. Sketchy mode is document state and uses `setSketchyMode`, not preferences.

### Font cache

A separate Dedicated Worker stores fonts in OPFS. Stable resource paths own filenames; hashes are validation metadata. A manifest hash change downloads and overwrites the same file, including truncating shorter replacements. Font parsing/layout remain in C#, while browser font faces support inline DOM text.

`editor.getFontCacheStatus()` synchronously returns read-only status summaries, including startup fonts. Subscribe to `fontCacheStatus` for later results:

| `cache` | Meaning |
| --- | --- |
| `hit` | Cached bytes match manifest hash and size |
| `stored` | Verified downloaded bytes were saved |
| `unavailable` | OPFS unavailable; verified online bytes are usable without persistent caching |
| `write-failed` | Cache write failed; verified online bytes are usable without persistent caching |

There is no CacheStorage or IndexedDB font-cache fallback. Missing offline fonts and invalid downloaded bytes fail resource preparation; cache failures do not justify rendering with unverified bytes. Font OPFS alone does not provide complete App/WASM offline startup.

### Worker relocation

All document IndexedDB operations run in the SDK's static Dexie Worker. Font I/O uses a separate OPFS Worker. Do not open their database or reproduce transactions in application code. Persistent mode requires IndexedDB, Workers and origin-wide Web Locks. Browser storage can be denied or evicted; external backups remain the host's responsibility.

Standalone persistence does not require a synchronization module. Local edits,
Undo/Redo and reopening retain complete history and clocks without generating
outgoing delivery records. Checkpoint state and its engine-supplied clock metadata
are committed atomically. Private application composition may register delivery;
its offline outbox is distinct from standalone local history and is not a public
editor API.

The two build artifacts are `dist/workers/document.worker.js` and `dist/workers/resource.worker.js`. Both are self-contained classic Worker scripts. If the bundler/host does not preserve their module-relative URLs, copy these exact files from the same package version into your static asset pipeline and provide their served locations:

```javascript
const editor = await createEditor({
  container,
  assetBaseUrl: '/editor/',
  persistence: { mode: 'persistent', namespace: 'local-diagrams', documentId: 'diagram-1' },
  workerUrls: {
    document: '/editor-workers/document.worker.js',
    resource: '/editor-workers/resource.worker.js',
  },
});
```

For a host needing a custom loader, `workerFactory` receives a URL and optional `{ name }`. Return the Worker and an idempotent disposer that terminates it and releases any Blob URL you created. Do not import internal SDK factory files. The SDK owns when to invoke the disposer. Keep Worker loading and `worker-src`/`connect-src`/WASM CSP permissions consistent with the host's actual asset origins. VS Code's final host migration is still pending; these hooks are not a claim that the migrated integration is complete.

## Errors and lifecycle

Public methods validate basic shapes in JS and semantic constraints in C#. Invalid local options reject with TypeError. Native and Worker failures carry code, message and optional cause. Error codes are extensible strings.

| Code / condition | Host response |
| --- | --- |
| `EditorAlreadyMounted`, `StartupTimeout` | Verify matching runtime/package, asset URLs, CSP and startup diagnostics |
| `EditorBusy`, `InteractionBusy` | Finish the current gesture/text operation; do not silently cancel it |
| `EditingDisabled`, `UnsupportedCommand`, `EmptySelection` | Update controls from current permissions/capabilities/selection |
| `StaleSelection`, `InvalidTarget` | Refresh the relevant UI or reopen the intended document; reject stale intent |
| `InvalidArgument`, `InvalidDocument`, `MissingDocument` | Report invalid input; preserve the current document |
| `StorageConflict` | Resolve the existing writer or changed checkpoint; do not add another writer |
| `StorageUnavailable`, `StorageWorkerFailed` | Report persistence failure; do not silently downgrade an existing persistent document |
| `EditorFaulted` | Stop edits/exports; explicitly recover the pending storage batch or load a known-good document |
| `NoPendingCommit` | No retained batch exists for `retryPersistence`; it is not a generic retry button |
| `PreferenceReadFailed`, `PreferenceWriteFailed`, `InvalidPreferences` | Report preference storage failure |
| `ResourceUnavailable`, `ResourceHashMismatch`, `ResourceWorkerFailed` | Restore valid matching resources/connectivity; do not use corrupt cache bytes |
| `ClipboardEmpty`, `ClipboardUnavailable`, `ClipboardPermissionDenied`, `ClipboardFormatUnsupported` | Ask for a supported source/access or use an explicit internal operation |
| `UnknownAction`, `ActionUnavailable`, `HostActionFailed` | Resolve the host action/state/error |
| `EditorDisposed` | Stop using this instance |
| `DisposeCleanupUnconfirmed` | Cleanup was not confirmed; reload the page before opening a successor |

A local transaction failure may set health to faulted and revision to null. retryPersistence is reserved for an identical retained storage batch with uncertain completion. Direct editor operations have no transport timeout or automatic retry.

Await editor.dispose() before switching documents. It cancels host action signals, waits for document operations, disposes the native root and document scope, releases Workers/writer ownership and removes UI. Persistent documents remain; the internal copy buffer is discarded. Blazor and browser fonts stay loaded for the page. Only one active canvas is supported. Unconfirmed cleanup blocks a successor until page reload.

## How JS interoperates with the engine

**The public API uses named asynchronous functions. Internally, JS calls a single managed semantic dispatcher directly.**

The SDK serializes native operations, invokes ExecuteAsync(method, arguments) on the current .NET object reference and resolves the returned Promise. C# validates intent, applies transactions and publishes immutable state/selection events. There is no frame, window-message handshake or runtime MessagePort.

Storage, font and preference callbacks are direct JS functions independent of the operation queue, so C# can await them without deadlock. Dedicated Workers own IndexedDB and OPFS I/O using request IDs. Subscription registration, host actions and clipboard helpers remain in JS. Private synchronization is owned by the site.

Use `editor.setTool('rectangle')`, `editor.editScene({ revision, description, changes })` and the other documented functions. There is no supported `editor.sendCommand(...)`, raw-port accessor or direct call to internal Blazor globals. Do not deep-import protocol/Worker implementation files. React controls use the same batch API as custom host controls. Private synchronization integration remains separate site work and is not documented as a public SDK facility.

## Integration checklist

- Use one matching SDK/runtime/Worker set and explicitly size the container.
- Choose full, React or core mounting once; give each instance one UI owner.
- Configure corner/drawing/context controls and text policy independently.
- Choose a temporary document or an explicit persistent identity; await disposal before switching.
- Read capabilities/state and retain the selection token for the user's displayed intent.
- Keep model and canvas screen coordinates distinct, both Y down.
- Save opaque snapshots with their revision and keep older acknowledgments from clearing newer edits.
- Start OS clipboard access in a user gesture and expose internal copy/paste explicitly.
- Handle resource/storage failures, uncertain request completion and cleanup errors.
- Verify the actual packaged WASM/UI in the target browser. Draft component/Worker checks do not replace standalone-editor or real-App E2E.
