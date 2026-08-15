import { createAbortError, DrawMotiveError } from './errors.js';

/** Throws before host work begins when initialization was already cancelled. */
export function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

/** Waits for an initialization resource while guaranteeing cleanup after cancellation. */
export async function waitForInitialResource(factory, signal) {
  throwIfAborted(signal);
  const resourcePromise = Promise.resolve().then(factory);
  if (!signal) return resourcePromise;
  let rejectAbort;
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(createAbortError());
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([resourcePromise, abortPromise]);
  } catch (error) {
    if (error?.name === 'AbortError') void resourcePromise.then((resource) => resource?.dispose?.()).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** Verifies the runtime boundary before exposing an editor instance. */
export async function validateAbi(resource, expectedAbi) {
  if (resource?.abiVersion === expectedAbi) return resource;
  await resource?.dispose?.();
  throw new DrawMotiveError('ABI_MISMATCH', `Expected ABI ${expectedAbi} but received ${resource?.abiVersion ?? 'none'}`, {
    details: { expected: expectedAbi, actual: resource?.abiVersion ?? null },
  });
}

/** Wraps editor resources in an isolated scheduler with deterministic disposal. */
export function createManagedInstance(resources) {
  let state = 'ready';
  let mutationTail = Promise.resolve();
  let disposePromise;
  const active = new Set();
  const ensureReady = () => {
    if (state !== 'ready') throw new DrawMotiveError('INSTANCE_DISPOSED', 'The runtime instance is disposing or disposed', { details: { state } });
  };
  const track = (promise) => {
    const tracked = Promise.resolve(promise);
    active.add(tracked);
    void tracked.finally(() => active.delete(tracked)).catch(() => undefined);
    return tracked;
  };
  return {
    get state() { return state; },
    async readonly(operation) { ensureReady(); return track(Promise.resolve().then(operation)); },
    async mutate(operation) {
      ensureReady();
      const result = mutationTail.then(operation);
      mutationTail = result.catch(() => undefined);
      return track(result);
    },
    dispose() {
      if (disposePromise) return disposePromise;
      state = 'disposing';
      disposePromise = (async () => {
        await Promise.allSettled([...active]);
        for (const resource of resources) await resource?.dispose?.();
        state = 'disposed';
      })();
      return disposePromise;
    },
  };
}
