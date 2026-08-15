import { DrawMotiveError } from './runtime/errors.js';

const contracts = Object.freeze({
  files: ['open', 'save'],
  storage: ['get', 'set', 'delete'],
  theme: ['getCurrent', 'subscribe'],
  commands: ['execute', 'subscribe'],
  network: ['fetch'],
});
const subscriptions = new Set(['theme.subscribe', 'commands.subscribe']);

/** Validates Editor host adapters and captures an immutable method snapshot. */
export function validateEditorAdapters(adapters = {}) {
  if (adapters === null || typeof adapters !== 'object') invalid('adapters');
  const snapshot = {};
  for (const [name, methods] of Object.entries(contracts)) {
    const adapter = adapters[name];
    if (adapter === undefined) continue;
    if (adapter === null || typeof adapter !== 'object') invalid(name);
    const captured = {};
    for (const method of methods) {
      if (typeof adapter[method] !== 'function') invalid(name, method);
      const invoke = adapter[method].bind(adapter);
      captured[method] = subscriptions.has(`${name}.${method}`)
        ? (...args) => wrapSubscription(name, method, invoke(...args))
        : invoke;
    }
    snapshot[name] = Object.freeze(captured);
  }
  return Object.freeze(snapshot);
}

/** Selects only the adapter subset understood by TextGraph. */
export function selectTextGraphAdapters(adapters) {
  return Object.freeze({
    ...(adapters.files ? { files: adapters.files } : {}),
    ...(adapters.network ? { network: adapters.network } : {}),
  });
}

function wrapSubscription(adapter, method, unsubscribe) {
  if (typeof unsubscribe !== 'function') invalid(adapter, method);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    return unsubscribe();
  };
}

function invalid(adapter, method) {
  throw new DrawMotiveError('INVALID_ADAPTER', `Adapter ${adapter}${method ? `.${method}` : ''} does not satisfy its contract`, {
    details: { adapter, method: method ?? null },
  });
}
