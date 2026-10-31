import { test, expect } from '@playwright/test';

test.use({ launchOptions: { executablePath: process.env.DRAWMOTIVE_CHROMIUM_PATH } });
test.beforeEach(async ({ page }) => {
  await page.goto('/test/browser/ui-harness.html');
  await page.waitForFunction(() => typeof mount === 'function');
  await page.evaluate(async () => {
    const { createEditorClipboard } = await import('/src/platform/clipboard.js');
    const instance = mount(); instances.push(instance); instance.select();
    const canvas = instance.root.querySelector('canvas'); canvas.tabIndex = 0;
    globalThis.access = []; globalThis.captures = []; globalThis.pasted = [];
    instance.editor.copySelection = token => {
      captures.push(token); return new Promise(resolve => { globalThis.finishCopy = resolve; });
    };
    instance.editor.pasteSelection = async (payload, point) => { pasted.push({ payload, point }); };
    instance.clipboard = createEditorClipboard(instance.editor, {
      clipboard: {
        write(items) {
          access.push({ method: 'write', active: navigator.userActivation.isActive });
          return items[0].getType('text/plain').then(blob => blob.text()).then(text => { globalThis.copiedText = text; });
        },
        readText() { access.push({ method: 'read', active: navigator.userActivation.isActive }); return Promise.resolve(copiedText); },
      }, ClipboardItem, Blob, getPastePosition: () => Promise.resolve({ x: 12, y: 34 }),
    });
    instance.editor.copyToClipboard = (...args) => instance.clipboard.copy(...args);
    instance.editor.pasteFromClipboard = (...args) => instance.clipboard.paste(...args);
    instance.editor.onDisposed(() => instance.clipboard.dispose());
  });
  await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toBeVisible();
});

for (const trigger of ['shortcut', 'menu']) test(`${trigger} starts system copy in the gesture before deferred graph capture`, async ({ page }) => {
  if (trigger === 'shortcut') await page.locator('canvas').press('Control+c');
  else {
    await page.getByTestId('context-toolbar-more-options').click();
    await page.getByTestId('panel-more-options-copy').click();
  }
  expect(await page.evaluate(() => access)).toEqual([{ method: 'write', active: true }]);
  expect(await page.evaluate(() => captures.length)).toBe(1);
  expect(await page.evaluate(() => typeof copiedText)).toBe('undefined');
  await page.evaluate(async () => { const { png } = await import('/test/fixtures/clipboard-image.mjs'); finishCopy({ version: 1, data: 'AQID', png }); });
  await page.waitForFunction(() => typeof copiedText === 'string');
  await page.locator('canvas').press('Control+v');
  await expect.poll(() => page.evaluate(() => pasted)).toEqual([{ payload: { version: 1, data: 'AQID' }, point: { x: 12, y: 34 } }]);
  expect(await page.evaluate(() => access.at(-1))).toEqual({ method: 'read', active: true });
});

test('host inputs and native inline text keep browser text copy and paste', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'host-input'; document.body.append(input);
    const inline = document.createElement('div'); inline.contentEditable = 'plaintext-only';
    inline.dataset.testid = 'd-canvas-content-editable';
    instances[0].root.querySelector('.drawmotive-canvas-host').append(inline);
  });
  for (const selector of ['#host-input', '[data-testid="d-canvas-content-editable"]']) {
    const input = page.locator(selector);
    await input.fill('browser text'); await input.press('Control+a'); await input.press('Control+c');
    await input.fill(''); await input.press('Control+v');
    if (selector === '#host-input') await expect(input).toHaveValue('browser text');
    else await expect(input).toHaveText('browser text');
  }
  expect(await page.evaluate(() => access)).toEqual([]);
  expect(await page.evaluate(() => captures)).toEqual([]);
  expect(await page.evaluate(() => pasted)).toEqual([]);
});
