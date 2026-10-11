# Changelog

## 0.2.2-alpha.7

- Replace product-specific initialization with atomic document, snapshot, viewport, history and editing operations.
- Configure built-in visibility and host actions at creation; freeze optional modules before runtime startup.
- Use protocol v2 over a per-instance MessagePort with explicit request and disposal outcomes.
- Read and write embedded PNG documents entirely in the existing WASM runtime, without additional image dependencies.
- Omit site-only analytics and authentication implementations from the embedded runtime.
- Document supported environments, contributor checks and redistribution notices.

This release makes breaking JS and transport changes; upgrade the SDK and copied runtime together.

## 0.2.2-alpha.2

- Public npm package for embedding the browser editor with `initializeEditor`.
- Import TextGraph or an opaque saved document, export the editable document and PNG, and dispose the editor.
- Include the compiled editor runtime, asset-copy CLI, integrity manifest and third-party notices.

This entry records the capabilities present in the package, without assigning
a release date or reconstructing earlier release history.
