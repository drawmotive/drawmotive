/// <reference lib="webworker" />
import { createRuntimeChannel } from '../../bridge/runtime-channel.js';
import { PROTOCOL_VERSION } from '../../bridge/protocol.js';
import { createOpfsFontCache, type FontResource } from './opfs-font-cache';
declare const self: DedicatedWorkerGlobalScope;

const cache = createOpfsFontCache();
const active = new Set<Promise<unknown>>();
let connected = false, closing = false;
self.addEventListener('message', event => {
  const message = event.data;
  if (connected || message?.type !== 'drawmotive:resource-connect' || message.protocolVersion !== PROTOCOL_VERSION || !message.port) return;
  connected = true;
  const channel = createRuntimeChannel({ port: message.port, instanceId: message.instanceId, documentSessionId: null });
  channel.onRequest('fonts.load', async (resource: FontResource) => {
    if (closing) throw Object.assign(new Error('Resource Worker is closing.'), { code: 'EditorDisposed' });
    const operation = cache.load(resource);
    active.add(operation);
    try { return await operation; } finally { active.delete(operation); }
  }, { lane: 'platform' });
  channel.onRequest('fonts.close', async () => {
    closing = true;
    await Promise.allSettled([...active]);
    return null;
  }, { lane: 'platform' });
});
