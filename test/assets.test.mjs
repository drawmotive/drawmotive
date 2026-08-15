import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRuntimeAssets } from '../src/index.js';

const manifest = { assets: [{ path: 'wasm/editor.wasm', mediaType: 'application/wasm' }] };

test('Editor resolves package assets from file, CDN, bundler, and no-bundler module URLs', () => {
  const cases = [
    ['file:///app/node_modules/@drawmotive/editor/src/runtime/assets.js', 'file:///app/node_modules/@drawmotive/editor/generated/wasm/editor.wasm'],
    ['https://cdn.example/@drawmotive/editor/src/runtime/assets.js', 'https://cdn.example/@drawmotive/editor/generated/wasm/editor.wasm'],
    ['https://app.example/assets/@drawmotive/editor/src/runtime/assets-HASH.js', 'https://app.example/assets/@drawmotive/editor/generated/wasm/editor.wasm'],
    ['https://example.test/vendor/editor/src/runtime/assets.js', 'https://example.test/vendor/editor/generated/wasm/editor.wasm'],
  ];
  for (const [moduleUrl, expected] of cases) {
    assert.equal(resolveRuntimeAssets({ manifest, moduleUrl })[0].url.href, expected);
  }
});

test('Editor accepts URL overrides and rejects relative override results', () => {
  const absolute = resolveRuntimeAssets({ manifest, moduleUrl: import.meta.url, resolveAsset: (_asset, defaultUrl) => new URL(defaultUrl) });
  assert.ok(absolute[0].url.href.endsWith('/generated/wasm/editor.wasm'));
  assert.throws(
    () => resolveRuntimeAssets({ manifest, moduleUrl: import.meta.url, resolveAsset: () => '../editor.wasm' }),
    (error) => error.code === 'INVALID_ASSET_URL',
  );
});
