import { EditorError } from '../errors.js';

const keys = new Set(['darkTheme', 'showGrid', 'snapToGrid']);
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Editor preferences must be a plain object.');
  const result = {};
  for (const [key, setting] of Object.entries(value)) {
    if (!keys.has(key) || typeof setting !== 'boolean')
      throw new TypeError('Unknown or invalid editor preference: ' + key);
    result[key] = setting;
  }
  return Object.freeze(result);
}
export { validate as validatePreferences };

/** Host-only appearance preferences. No document, account or authentication data. */
export function createPreferenceStore({ storage, key = 'drawmotive.editor.preferences.v1' } = {}) {
  function read() {
    let serialized;
    try { serialized = (storage ?? globalThis.localStorage).getItem(key); }
    catch (cause) { throw new EditorError('PreferenceReadFailed', 'Editor preferences could not be read.', { cause }); }
    if (serialized === null) return Object.freeze({});
    try { return validate(JSON.parse(serialized)); }
    catch (cause) { throw new EditorError('InvalidPreferences', 'Saved editor preferences are invalid.', { cause }); }
  }
  function write(value) {
    try { (storage ?? globalThis.localStorage).setItem(key, JSON.stringify(value)); }
    catch (cause) { throw new EditorError('PreferenceWriteFailed', 'Editor preferences could not be saved.', { cause }); }
    return value;
  }
  return Object.freeze({
    async read() { return read(); },
    // Keep read/merge/write synchronous within one host task, avoiding lost updates
    // between editors sharing this origin's preferences.
    async update(partial) {
      const patch = validate(partial);
      return write(Object.freeze({ ...read(), ...patch }));
    },
    async replace(value) { return write(validate(value)); },
  });
}
