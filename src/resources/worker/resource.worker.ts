/// <reference lib="webworker" />
import { serveWorkerRequests } from '../../platform/worker-channel.js';
import { createOpfsFontCache, type FontResource } from './opfs-font-cache';
declare const self: DedicatedWorkerGlobalScope;

const cache = createOpfsFontCache();
const active = new Set<Promise<unknown>>();
let closing = false;
// Independent font loads can overlap; close waits for every owned OPFS operation.
serveWorkerRequests(self, {
  initialize: () => null,
  'fonts.load': async (resource: FontResource) => {
    if (closing) throw Object.assign(new Error('Resource Worker is closing.'), { code: 'EditorDisposed' });
    const operation = cache.load(resource);
    active.add(operation);
    try { return await operation; } finally { active.delete(operation); }
  },
  'fonts.close': async () => {
    closing = true;
    await Promise.allSettled([...active]);
    return null;
  },
}, { concurrent: true });
