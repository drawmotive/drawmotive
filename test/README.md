# Browser verification inputs

`npm run test:browser` uses the SDK source and matching committed `generated/editor` assets by default. Source CI runs this default without an asset override. Changes to storage or private bridge contracts require synchronizing the generated assets and manifest from a verified companion source build.

For diagnostics before synchronization, `DRAWMOTIVE_EDITOR_TEST_ASSET_ROOT` can select a candidate's absolute `generated/editor` directory. The test server substitutes only native requests, leaving current SDK sources and Workers in place. A candidate-only pass does not replace verification of the committed default.

The source snapshot and its native provenance do not change the frozen formal release target. `source:check` validates the actual metadata, copies the complete runtime into a disposable source projection, and uses the unchanged readiness verifier with only that projection's producer set to the actual manifest SHA. Source CI also performs asset and package audits before packing with `--ignore-scripts`; ordinary prepack and publication still require the formal release target's exact native source.
