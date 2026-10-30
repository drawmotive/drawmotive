/** v3 replaces the previous bridge; every message belongs to one editor session. */
export const PROTOCOL_VERSION = 3;

export const ERROR_CODES = Object.freeze(Object.fromEntries([
  'ProtocolMismatch', 'InvalidMessage', 'InvalidRuntimeResponse', 'EditorDisposed',
  'RequestTimeoutUnknown', 'RequestAborted', 'RequestAbortedUnknown', 'StaleDocumentSession', 'UnknownMethod',
  'ReverseCallDuringDocumentCommand',
  'RuntimeError', 'RuntimeUnavailable', 'HostActionFailed', 'UnknownAction', 'ActionUnavailable',
  'InvalidDocument', 'InteractionBusy', 'StorageConflict', 'StorageUnavailable',
  'ResourceUnavailable', 'ModuleUnavailable', 'StartupTimeout', 'DisposeCleanupUnconfirmed',
].map(code => [code, code])));

/** Deadlines preserve completion ownership because a mutation may already have committed. */
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

/** Validate before dispatch: accepting unscoped v2 envelopes would break isolation. */
export function assertProtocolMessage(value) {
  if (!record(value)) throw new EditorError(ERROR_CODES.InvalidMessage, 'Editor message must be an object');
  if (value.protocolVersion !== PROTOCOL_VERSION) throw new EditorError(ERROR_CODES.ProtocolMismatch, 'Unsupported editor runtime protocol');
  if (!identifier(value.instanceId) || !(value.documentSessionId === null || identifier(value.documentSessionId))
      || !['document', 'platform'].includes(value.lane) || !['request', 'response', 'event'].includes(value.type)) {
    throw new EditorError(ERROR_CODES.InvalidMessage, 'Invalid editor message scope');
  }
  if (value.type === 'event') {
    if (!identifier(value.name) || own(value, 'requestId')) throw new EditorError(ERROR_CODES.InvalidMessage, 'Invalid editor event');
  } else {
    if (!identifier(value.requestId)) throw new EditorError(ERROR_CODES.InvalidMessage, 'Editor request ID is required');
    if (value.type === 'request' && !identifier(value.method)) throw new EditorError(ERROR_CODES.InvalidMessage, 'Editor request method is required');
    if (value.type === 'response' && (own(value, 'result') === own(value, 'error') || (own(value, 'error') && !validError(value.error)))) {
      throw new EditorError(ERROR_CODES.InvalidMessage, 'Editor response requires one result or structured error');
    }
  }
  return value;
}

export function isProtocolMessage(value) {
  try { assertProtocolMessage(value); return true; } catch { return false; }
}

export function createRequest({ instanceId, documentSessionId, requestId, method, args = {}, lane = 'document' }) {
  return immutableSnapshot(assertProtocolMessage({ protocolVersion: PROTOCOL_VERSION, type: 'request', lane, instanceId, documentSessionId, requestId, method, args }));
}

export function createResponse(request, outcome) {
  assertProtocolMessage(request);
  if (request.type !== 'request' || !record(outcome)) throw new EditorError(ERROR_CODES.InvalidMessage, 'A response requires a request and outcome');
  const message = {
    protocolVersion: PROTOCOL_VERSION, type: 'response', lane: request.lane,
    instanceId: request.instanceId, documentSessionId: request.documentSessionId, requestId: request.requestId,
  };
  if (own(outcome, 'result')) message.result = outcome.result;
  if (own(outcome, 'error')) message.error = toErrorDescriptor(outcome.error);
  return immutableSnapshot(assertProtocolMessage(message));
}

export function createEvent({ instanceId, documentSessionId, name, data, lane = 'document' }) {
  return immutableSnapshot(assertProtocolMessage({ protocolVersion: PROTOCOL_VERSION, type: 'event', lane, instanceId, documentSessionId, name, data }));
}
