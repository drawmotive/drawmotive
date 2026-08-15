export * from '../index.js';

import type { RuntimeAsset, RuntimeAssetLoader, RuntimeAssetManifest } from '../index.js';

export declare const platform: 'browser';

export declare function createEditorRuntimeLoader(options: {
  manifest: RuntimeAssetManifest;
  moduleUrl?: string | URL;
  resolveAsset?(asset: RuntimeAsset, defaultUrl: URL): string | URL;
  fetch?: typeof fetch;
}): RuntimeAssetLoader;
