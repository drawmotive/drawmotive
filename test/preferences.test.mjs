import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreferenceStore } from '../src/platform/preferences.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
}
test('host JS stores editor preferences independently of document identity', async () => {
  const storage = memoryStorage(), first = createPreferenceStore({ storage });
  assert.deepEqual(await first.read(), {});
  await first.update({ darkTheme: true,showGrid: false });
  const restored = createPreferenceStore({ storage });
  assert.deepEqual(await restored.update({ snapToGrid: true }), { darkTheme: true,showGrid: false,snapToGrid: true });
  assert.deepEqual(await first.read(), { darkTheme: true,showGrid: false,snapToGrid: true });
});
test('unknown and nonboolean values cannot overwrite a valid preference record', async () => {
  const store = createPreferenceStore({ storage: memoryStorage() });
  await store.update({ darkTheme: true });
  for (const invalid of [{ darkTheme: 'yes' },{ accountToken: 'secret' },null,[]]) await assert.rejects(store.update(invalid),TypeError);
  assert.deepEqual(await store.read(), { darkTheme: true });
});
test('corrupt persisted preferences report an explicit recoverable error', async () => {
  const storage = memoryStorage(); storage.setItem('drawmotive.editor.preferences.v1','{invalid');
  const store = createPreferenceStore({ storage });
  await assert.rejects(store.read(),{ code: 'InvalidPreferences' });
  // An explicit successful replacement can recover preferences without touching documents.
  await store.replace({ showGrid: true });
  assert.deepEqual(await store.read(),{ showGrid: true });
});
test('denied or full local storage cannot claim a successful preference update', async () => {
  const store = createPreferenceStore({ storage: { getItem: () => null,setItem() { throw new Error('Quota'); } } });
  await assert.rejects(store.update({ darkTheme: true }),{ code: 'PreferenceWriteFailed' });
  assert.deepEqual(await store.read(),{});
});
