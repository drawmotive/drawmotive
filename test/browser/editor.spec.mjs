import { test, expect } from '@playwright/test';

test('real embedded editor imports, exports and reopens a document', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/examples/browser/');
  await expect(page.locator('#status')).toHaveText('Ready to edit');
  const editor = page.frameLocator('iframe');
  await expect(editor.locator('[data-testid="dcanvas"]')).toBeVisible();
  await expect(editor.locator('[data-testid="home-toolbar-undo"]')).toBeDisabled();
  await editor.locator('[data-testid="home-toolbar-rectangle"]').click();
  const canvas = await editor.locator('canvas').first().boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.85, canvas.y + canvas.height * 0.85, { steps: 8 });
  await page.mouse.up();
  await expect(editor.locator('[data-testid="home-toolbar-undo"]')).toBeEnabled();
  await editor.locator('canvas').first().press('Escape');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('diagram.png');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect([...Buffer.concat(chunks).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.locator('#source').fill('Start -> Review -> Finish');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.locator('#status')).toHaveText('Ready to edit');
  await expect(editor.locator('[data-testid="home-toolbar-undo"]')).toBeDisabled();
  const saveEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save document' }).click();
  const saved = await saveEvent;
  await page.locator('#file').setInputFiles(await saved.path());
  await expect(page.locator('#status')).toHaveText('Document opened');
  expect(errors).toEqual([]);
});

test('public API preserves the document after invalid import and releases the frame', async ({ page }) => {
  await page.goto('/examples/browser/index.html');
  const result = await page.evaluate(async () => {
    const { initializeEditor } = await import('/src/index.js');
    const container = document.createElement('div');
    container.style.height = '600px';
    document.body.append(container);
    const editor = await initializeEditor({ container, assetBaseUrl: '/generated/editor/', source: 'A -> B' });
    const before = await editor.exportDocument();
    let rejected = false;
    try { await editor.importDocument('not-valid-base64'); } catch { rejected = true; }
    const after = await editor.exportDocument();
    await editor.dispose();
    return { rejected, before, after, frames: container.querySelectorAll('iframe').length, state: editor.state };
  });
  expect(result.rejected).toBe(true);
  expect(result.after.png).toBe(result.before.png);
  expect(result.after.raw).toBe(result.before.raw);
  expect(result.before.width).toBeGreaterThan(0);
  expect(result.frames).toBe(0);
  expect(result.state).toBe('disposed');
});

test('example keeps controls and editor accessible on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/examples/browser/');
  await expect(page.locator('#status')).toHaveText('Ready to edit');
  await expect(page.getByRole('button', { name: 'Generate diagram' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('iframe')).toHaveAttribute('title', 'DrawMotive diagram editor');
});
