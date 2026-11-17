# Changelog

## Unreleased

- Breaking: binary values are `Uint8Array` across the public API. `EditorSnapshot.raw`
  and the new `png.bytes` (replacing `png.base64`) are bytes; `replaceDocument(raw)`,
  `replacePngDocument(png)` and `pasteImage(data)` accept bytes and reject base64 text.
- Breaking: selection payloads carry `data` and the optional `png` companion as bytes.
  Base64 remains only inside the cross-application system clipboard text envelope.
- The native bridge carries documents, images, fonts and replication payloads beside
  its JSON envelope instead of as base64, and Worker messages transfer exclusively
  owned buffers instead of cloning them. Fonts are written once, directly into the
  memory Skia adopts.

## 0.2.2-alpha.8

- Replace product-specific initialization with atomic document, snapshot, viewport, history and editing operations.
- Configure built-in visibility and host actions at creation; freeze optional modules before runtime startup.
- Use protocol v2 over a per-instance MessagePort with explicit request and disposal outcomes.
- Read and write embedded PNG documents entirely in the existing WASM runtime, without additional image dependencies.
- Exclude the complete site composition from embedded builds; optional site components inject their direct dependencies.
- Document supported environments, contributor checks and redistribution notices.

This release makes breaking JS and transport changes; upgrade the SDK and copied runtime together.

## 0.2.2-alpha.2

- Public npm package for embedding the browser editor with `initializeEditor`.
- Import TextGraph or an opaque saved document, export the editable document and PNG, and dispose the editor.
- Include the compiled editor runtime, asset-copy CLI, integrity manifest and third-party notices.

This entry records the capabilities present in the package, without assigning
a release date or reconstructing earlier release history.
