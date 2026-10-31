import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../src/resources/worker/opfs-font-cache.ts').catch(() => ({}));
const hash = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const bytes = value => new TextEncoder().encode(value);

function filesystem() {
  const files = new Map(), writes = [];
  let failWrite = false;
  const directory = prefix => ({
    async getDirectoryHandle(name) { return directory(prefix + name + '/'); },
    async removeEntry(name) { files.delete(prefix + name); },
    async getFileHandle(name, { create = false } = {}) {
      const key = prefix + name;
      if (!files.has(key)) {
        if (!create) throw new DOMException('Missing', 'NotFoundError');
        files.set(key, new Uint8Array());
      }
      return {
        async getFile() { const data = files.get(key).slice(); return { arrayBuffer: async () => data.buffer }; },
        async createSyncAccessHandle() {
          return {
            write(data) {
              writes.push(key);
              if (failWrite) { files.set(key, data.slice(0, 1)); throw new DOMException('Full', 'QuotaExceededError'); }
              const old = files.get(key), next = new Uint8Array(Math.max(old.length, data.length));
              next.set(old); next.set(data); files.set(key, next); return data.length;
            },
            truncate(length) { files.set(key, files.get(key).slice(0, length)); },
            flush() {}, close() {},
          };
        },
      };
    },
  });
  return { root: directory(''), files, writes, fail: value => { failWrite = value; } };
}

test('font cache uses a stable filename and truncates old longer bytes on hash update', async () => {
  assert.equal(typeof module.createOpfsFontCache, 'function', 'OPFS cache is implemented');
  const fs = filesystem(); let downloads = 0;
  let current = bytes('a longer original font');
  const cache = module.createOpfsFontCache({ getDirectory: async () => fs.root, fetchBytes: async () => { downloads++; return current; } });
  const resource = async () => ({ path: 'fonts/NotoSans.ttf', url: 'https://assets.test/NotoSans.ttf', sha256: await hash(current) });
  assert.equal((await cache.load(await resource())).cache, 'stored');
  assert.equal((await cache.load(await resource())).cache, 'hit');
  current = bytes('new');
  assert.deepEqual((await cache.load(await resource())).bytes, current);
  assert.equal(downloads, 2);
  assert.deepEqual([...fs.files.keys()].sort(), ['fonts/NotoSans.ttf', 'fonts/NotoSans.ttf.meta.json']);
  assert.deepEqual(fs.files.get('fonts/NotoSans.ttf'), current);
});

test('corrupt bytes and interrupted writes cannot produce a cache hit', async () => {
  assert.equal(typeof module.createOpfsFontCache, 'function');
  const fs = filesystem(), data = bytes('font bytes'); let downloads = 0;
  const resource = { path: 'fonts/font.ttf', url: 'https://assets.test/font.ttf', sha256: await hash(data) };
  const cache = module.createOpfsFontCache({ getDirectory: async () => fs.root, fetchBytes: async () => { downloads++; return data; } });
  await cache.load(resource);
  fs.files.set('fonts/font.ttf', bytes('bad'));
  await cache.load(resource);
  assert.equal(downloads, 2);
  fs.files.set('fonts/font.ttf.meta.json', bytes('invalid json'));
  fs.fail(true);
  assert.equal((await cache.load(resource)).cache, 'write-failed');
  assert.equal(fs.files.has('fonts/font.ttf.meta.json'), false);
  fs.fail(false);
  assert.equal((await cache.load(resource)).cache, 'stored');
});

test('invalid downloads preserve the previous valid cache without claiming new hash', async () => {
  assert.equal(typeof module.createOpfsFontCache, 'function');
  const fs = filesystem(), original = bytes('old'), replacement = bytes('new');
  let download = original;
  const cache = module.createOpfsFontCache({ getDirectory: async () => fs.root, fetchBytes: async () => download });
  const old = { path: 'fonts/font.ttf', url: 'https://assets.test/font.ttf', sha256: await hash(original) };
  await cache.load(old);
  await assert.rejects(cache.load({ ...old, sha256: await hash(replacement) }), { code: 'ResourceHashMismatch' });
  assert.deepEqual((await cache.load(old)).bytes, original);
});

test('unavailable OPFS loads verified online bytes and offline failure remains explicit', async () => {
  assert.equal(typeof module.createOpfsFontCache, 'function');
  const data = bytes('font'); let offline = false;
  const resource = { path: 'fonts/font.ttf', url: 'https://assets.test/font.ttf', sha256: await hash(data) };
  const cache = module.createOpfsFontCache({ getDirectory: async () => { throw new Error('OPFS unavailable'); }, fetchBytes: async () => { if (offline) throw new Error('offline'); return data; } });
  assert.equal((await cache.load(resource)).cache, 'unavailable');
  offline = true;
  await assert.rejects(cache.load(resource), { code: 'ResourceUnavailable' });
});

test('concurrent requests serialize one resource and invalid resource paths never touch storage', async () => {
  assert.equal(typeof module.createOpfsFontCache, 'function');
  const fs = filesystem(), data = bytes('font'); let downloads = 0;
  const cache = module.createOpfsFontCache({ getDirectory: async () => fs.root, fetchBytes: async () => { downloads++; return data; } });
  const resource = { path: 'fonts/font.ttf', url: 'https://assets.test/font.ttf', sha256: await hash(data) };
  const results = await Promise.all([cache.load(resource), cache.load(resource), cache.load(resource)]);
  assert.equal(downloads, 1);
  assert.deepEqual(results.map(result => result.cache), ['stored', 'hit', 'hit']);
  for (const path of ['../font.ttf', '/font.ttf', 'fonts/../font.ttf', 'fonts%2ffont.ttf', 'font.ttf?x', 'fonts\\font.ttf'])
    await assert.rejects(cache.load({ ...resource, path }), { code: 'InvalidResource' });
});
