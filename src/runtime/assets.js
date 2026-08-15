import { DrawMotiveError } from './errors.js';

/** Resolves manifest assets relative to this package without ambient base URLs. */
export function resolveRuntimeAssets({ manifest, moduleUrl = import.meta.url, resolveAsset }) {
  if (!Array.isArray(manifest?.assets)) {
    throw new DrawMotiveError('INVALID_MANIFEST', 'The runtime manifest must contain an assets array');
  }
  const generatedBase = new URL('../../generated/', new URL(moduleUrl));
  return manifest.assets.map((asset) => {
    const defaultUrl = new URL(asset.path, generatedBase);
    const override = resolveAsset ? resolveAsset(asset, defaultUrl) : defaultUrl;
    return Object.freeze({ asset, url: absoluteUrl(override, asset.path) });
  });
}

function absoluteUrl(value, assetPath) {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(value);
    if (!url.protocol) throw new TypeError('Missing protocol');
    return url;
  } catch (cause) {
    throw new DrawMotiveError('INVALID_ASSET_URL', `Asset ${assetPath} must resolve to an absolute URL`, {
      cause,
      details: { asset: assetPath, value: String(value) },
    });
  }
}
