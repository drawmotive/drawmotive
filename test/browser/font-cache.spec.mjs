import { test, expect } from '@playwright/test';

test('real OPFS Worker replaces the stable font file, reopens offline and rejects corrupt bytes', async ({ page, context }) => {
  await page.route('**/font-worker-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Font Worker verification</title>' }));
  let download = 'original font bytes with a longer length', offline = false, requests = 0;
  await context.route('**/test-font.ttf', route => {
    requests++;
    return offline ? route.abort('internetdisconnected') : route.fulfill({ contentType: 'font/ttf', body: download });
  });
  await page.goto('/font-worker-test');
  await page.evaluate(async () => {
    const { createResourceWorkerClient } = await import('/src/resources/resource-worker-client.js');
    window.fontClient = await createResourceWorkerClient();
    window.fontResource = async text => ({
      path: 'fonts/NotoSans.ttf', url: new URL('/test-font.ttf', location.href).href,
      sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join(''),
    });
  });
  const load = text => page.evaluate(async text => {
    const result = await fontClient.load(await fontResource(text));
    return { cache: result.cache, text: new TextDecoder().decode(result.bytes) };
  }, text);
  expect(await load(download)).toEqual({ cache: 'stored', text: download });
  expect(await load(download)).toEqual({ cache: 'hit', text: download });
  download = 'new';
  expect(await load(download)).toEqual({ cache: 'stored', text: download });
  expect(requests).toBe(2);
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await (await root.getDirectoryHandle('drawmotive-fonts')).getDirectoryHandle('fonts');
    const names = []; for await (const name of directory.keys()) names.push(name);
    const data = await (await directory.getFileHandle('NotoSans.ttf')).getFile();
    return { names: names.sort(), bytes: data.size, text: await data.text() };
  })).toEqual({ names: ['NotoSans.ttf', 'NotoSans.ttf.meta.json'], bytes: 3, text: 'new' });
  offline = true;
  await page.evaluate(async () => {
    await fontClient.dispose();
    const { createResourceWorkerClient } = await import('/src/resources/resource-worker-client.js');
    window.fontClient = await createResourceWorkerClient();
  });
  expect(await load(download)).toEqual({ cache: 'hit', text: download });
  expect(requests).toBe(2);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await (await root.getDirectoryHandle('drawmotive-fonts')).getDirectoryHandle('fonts');
    const handle = await directory.getFileHandle('NotoSans.ttf');
    const stream = await handle.createWritable(); await stream.write('bad'); await stream.close();
  });
  expect(await page.evaluate(async text => {
    try { await fontClient.load(await fontResource(text)); return null; } catch (error) { return error.code; }
  }, download)).toBe('ResourceUnavailable');
  await page.evaluate(() => fontClient.dispose());
});

test('a crashed font Worker rejects pending requests instead of claiming ready', async ({ page }) => {
  await page.route('**/font-worker-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto('/font-worker-test');
  expect(await page.evaluate(async () => {
    const { createResourceWorkerClient } = await import('/src/resources/resource-worker-client.js');
    const { createWorkerFactory } = await import('/src/platform/worker-factory.js');
    const factory = createWorkerFactory({ mode: 'blob', fetch: async () => new Response('throw new Error("crashed");') });
    const client = await createResourceWorkerClient({ workerFactory: factory });
    try { await client.load({ path: 'font.ttf', url: '/font.ttf', sha256: '0'.repeat(64) }); return null; }
    catch (error) { return error.code; }
    finally { await client.dispose(); }
  })).toBe('ResourceWorkerFailed');
});
