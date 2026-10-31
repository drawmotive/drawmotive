import { chromium, expect, test } from '@playwright/test';

// The full Chromium build exposes the native pending-handle lifetime defect;
// its headless shell does not reproduce the same collection behavior.
test.use({ launchOptions: {
  executablePath: process.env.DRAWMOTIVE_CHROMIUM_PATH ?? chromium.executablePath(),
  args: ['--js-flags=--expose-gc'],
} });

test('OPFS font writes keep pending file owners alive through garbage collection', async ({ page, context }) => {
  await context.route('**/pending-handle-font.ttf', route => route.fulfill({ contentType: 'font/ttf', body: 'verified font bytes' }));
  await page.goto('/test/browser/host.html');
  const results = await page.evaluate(async () => {
    const { createResourceWorkerClient } = await import('/src/resources/resource-worker-client.js');
    const { createWorkerFactory } = await import('/src/platform/worker-factory.js');
    const factory = createWorkerFactory({ mode: 'blob', fetch: async url => {
      const source = await (await fetch(url)).text();
      // Collect while the real native OPFS acquisition is awaiting its IPC reply.
      // A temporary FileSystemFileHandle otherwise loses that reply in Chromium.
      const collectPendingOwners = () => {
        if (typeof gc !== 'function') throw new Error('Explicit garbage collection is required.');
        const acquire = FileSystemFileHandle.prototype.createSyncAccessHandle;
        FileSystemFileHandle.prototype.createSyncAccessHandle = function () {
          const opening = acquire.call(this);
          setTimeout(() => gc(), 0);
          return opening;
        };
      };
      return new Response('(' + collectPendingOwners.toString() + ')();\n' + source, { headers: { 'content-type': 'text/javascript' } });
    } });
    const client = await createResourceWorkerClient({ workerFactory: factory, timeoutMs: 5000 });
    const bytes = new TextEncoder().encode('verified font bytes');
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    const resources = Array.from({ length: 25 }, (_, index) => ({ path: 'gc-fonts/font-' + index + '.ttf', url: new URL('/pending-handle-font.ttf', location.href).href, sha256 }));
    const stored = await Promise.all(resources.map(resource => client.load(resource)));
    await client.dispose();
    const reopened = await createResourceWorkerClient({ workerFactory: factory, timeoutMs: 5000 });
    const cached = await Promise.all(resources.map(resource => reopened.load(resource)));
    await reopened.dispose();
    return { stored: stored.map(result => result.cache), cached: cached.map(result => result.cache) };
  });
  expect(results.stored).toEqual(Array(25).fill('stored'));
  expect(results.cached).toEqual(Array(25).fill('hit'));
});
