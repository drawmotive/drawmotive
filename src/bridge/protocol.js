export const ERROR_CODES = Object.freeze(Object.fromEntries([
  'EditorAlreadyMounted', 'InvalidRuntimeResponse', 'EditorDisposed',
  'UnknownMethod',
  'RuntimeError', 'RuntimeUnavailable', 'HostActionFailed', 'UnknownAction', 'ActionUnavailable',
  'InvalidDocument', 'InteractionBusy', 'StorageConflict', 'StorageUnavailable',
  'ResourceUnavailable', 'ModuleUnavailable', 'StartupTimeout', 'DisposeCleanupUnconfirmed',
].map(code => [code, code])));

/** Structured failures shared by the direct native boundary and Worker I/O. */
export class EditorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EditorError';
    this.code = code;
    Object.assign(this, details);
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.trim().length > 0;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const validError = value => record(value) && identifier(value.code) && typeof value.message === 'string';

/** Copy transport values so no caller receives an engine-owned mutable reference.
 * Objects and arrays are frozen; binary values are independent structured copies. */
export function immutableSnapshot(value) {
  const result = structuredClone(value);
  const visited = new WeakSet();
  function freeze(item) {
    if (!item || typeof item !== 'object' || visited.has(item)) return item;
    visited.add(item);
    if (typeof SharedArrayBuffer !== 'undefined' && (item instanceof SharedArrayBuffer || (ArrayBuffer.isView(item) && item.buffer instanceof SharedArrayBuffer))) {
      throw new TypeError('Shared memory cannot provide detached editor snapshot ownership');
    }
    if (item instanceof Map) for (const [key, child] of item) { freeze(key); freeze(child); }
    if (item instanceof Set) for (const child of item) freeze(child);
    // Error.cause survives structured cloning but is not enumerable.
    if (item instanceof Error) {
      for (const key of Object.getOwnPropertyNames(item)) freeze(item[key]);
      Object.freeze(item);
    }
    if (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  }
  return freeze(result);
}

export function toErrorDescriptor(error, fallbackCode = ERROR_CODES.RuntimeError) {
  return Object.freeze({
    code: identifier(error?.code) ? error.code : fallbackCode,
    message: typeof error?.message === 'string' ? error.message : String(error),
  });
}

export function fromErrorDescriptor(value) {
  return validError(value)
    ? new EditorError(value.code, value.message)
    : new EditorError(ERROR_CODES.InvalidRuntimeResponse, 'Invalid structured editor error');
}

