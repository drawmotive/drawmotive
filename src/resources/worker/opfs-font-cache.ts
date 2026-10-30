export interface FontResource {
  path: string;
  url: string;
  sha256: string;
  byteLength?: number;
}
export interface FontResult {
  bytes: Uint8Array;
  cache: 'hit' | 'stored' | 'unavailable' | 'write-failed';
  detail?: string;
}
interface SyncHandle {
  write(bytes: Uint8Array, options?: { at: number }): number;
  truncate(length: number): void;
  flush(): void;
  close(): void;
}
interface FileHandle {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createSyncAccessHandle(): Promise<SyncHandle>;
}
interface Directory {
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<Directory>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
}
interface CacheOptions {
  getDirectory?: () => Promise<Directory>;
  fetchBytes?: (resource: FontResource) => Promise<Uint8Array>;
  withLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>;
}
function error(code: string, message: string, cause?: unknown) {
  return Object.assign(new Error(message, { cause }), { code });
}

/** Resource paths, rather than hashes or URL query parameters, own the cache filename. */
export function normalizeFontPath(path: string): string {
  if (typeof path !== 'string' || path.length > 512 || path !== path.normalize('NFC') ||
      /[\\%?#:\x00-\x1f\x7f]/.test(path) || path.endsWith('.meta.json') ||
      path.split('/').some(part => !part || part === '.' || part === '..'))
    throw error('InvalidResource', 'A stable relative font resource path is required.');
  return path;
}

async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
    value => value.toString(16).padStart(2, '0')).join('');
}
async function download(resource: FontResource): Promise<Uint8Array> {
  const response = await fetch(resource.url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('Font download failed: HTTP ' + response.status);
  return new Uint8Array(await response.arrayBuffer());
}
// Chromium can abandon a pending native acquisition when its FileHandle receiver
// is collected. Binary resource traffic can trigger GC before the IPC reply.
// Retain the owner until a sync handle takes ownership or acquisition rejects.
const pendingFileOwners = new Set<FileHandle>();
async function writeFile(directory: Directory, name: string, bytes: Uint8Array) {
  const file = await directory.getFileHandle(name, { create: true });
  pendingFileOwners.add(file);
  let handle: SyncHandle;
  try { handle = await file.createSyncAccessHandle(); }
  finally { pendingFileOwners.delete(file); }
  try {
    // Never leave stale trailing bytes when a replacement is shorter.
    if (handle.write(bytes, { at: 0 }) !== bytes.length) throw new Error('Incomplete OPFS write.');
    handle.truncate(bytes.length);
    handle.flush();
  } finally { handle.close(); }
}

/** Only import in the dedicated resource Worker; no persistent fallback or document DB access. */
export function createOpfsFontCache(options: CacheOptions = {}) {
  const tails = new Map<string, Promise<unknown>>();
  const getDirectory = options.getDirectory ?? (async () => {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('drawmotive-fonts', { create: true }) as unknown as Directory;
  });
  const fetchBytes = options.fetchBytes ?? download;
  // Web Locks coordinates separate editor resource Workers on the same origin.
  const withLock = options.withLock ?? (async <T>(key: string, action: () => Promise<T>) =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('drawmotive:font:' + key, action) : action());

  async function loadLocked(resource: FontResource): Promise<FontResult> {
    let directory: Directory | undefined, name = '', status: 'unavailable' | 'write-failed' = 'unavailable';
    let detail: string | undefined;
    try {
      directory = await getDirectory();
      const parts = resource.path.split('/'); name = parts.pop()!;
      for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
      status = 'write-failed';
      try {
        const metadataFile = await (await directory.getFileHandle(name + '.meta.json')).getFile();
        const meta = JSON.parse(new TextDecoder().decode(await metadataFile.arrayBuffer()));
        if (meta.sha256 === resource.sha256 && Number.isSafeInteger(meta.byteLength) && meta.byteLength > 0) {
          const fontFile = await (await directory.getFileHandle(name)).getFile();
          const cached = new Uint8Array(await fontFile.arrayBuffer());
          if (cached.length === meta.byteLength && (resource.byteLength === undefined || cached.length === resource.byteLength) && await digest(cached) === resource.sha256)
            return { bytes: cached, cache: 'hit' };
        }
      } catch { /* Missing, interrupted or corrupt entries are cache misses. */ }
    } catch (cause) { directory = undefined; detail = String(cause); }

    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await fetchBytes(resource)); }
    catch (cause) { throw error('ResourceUnavailable', 'Required font is unavailable: ' + resource.path, cause); }
    if (!bytes.length || (resource.byteLength !== undefined && bytes.length !== resource.byteLength) || await digest(bytes) !== resource.sha256)
      throw error('ResourceHashMismatch', 'Font bytes do not match the manifest: ' + resource.path);

    if (directory) {
      try {
        // The metadata and bytes are not an atomic pair. Invalidate first; publish metadata last.
        try { await directory.removeEntry(name + '.meta.json'); }
        catch (cause) { if ((cause as DOMException).name !== 'NotFoundError') throw cause; }
        await writeFile(directory, name, bytes);
        await writeFile(directory, name + '.meta.json', new TextEncoder().encode(JSON.stringify({ sha256: resource.sha256, byteLength: bytes.length })));
        return { bytes, cache: 'stored' };
      } catch (cause) { detail = String(cause); }
    }
    // The verified in-memory bytes can still start an online editor after a cache failure.
    return { bytes, cache: status, detail };
  }

  return Object.freeze({
    async load(resource: FontResource): Promise<FontResult> {
      const path = normalizeFontPath(resource?.path);
      if (!/^[a-f0-9]{64}$/.test(resource.sha256) ||
          (resource.byteLength !== undefined && (!Number.isSafeInteger(resource.byteLength) || resource.byteLength <= 0)))
        throw error('InvalidResource', 'A SHA-256 hash and valid font byte length are required.');
      const descriptor = { ...resource, path };
      const previous = tails.get(path) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(() => withLock(path, () => loadLocked(descriptor)));
      tails.set(path, current);
      try { return await current; }
      finally { if (tails.get(path) === current) tails.delete(path); }
    },
  });
}
