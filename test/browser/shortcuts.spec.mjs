import { test, expect } from '@playwright/test';

test.use({ launchOptions: { executablePath: process.env.DRAWMOTIVE_CHROMIUM_PATH } });
test.beforeEach(async ({ page }) => {
  await page.goto('/test/browser/ui-harness.html');
  await page.waitForFunction(() => typeof mount === 'function');
  await page.evaluate(() => {
    instances.push(mount());
    const canvas = instances[0].root.querySelector('canvas');
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', () => canvas.focus());
  });
  await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toBeVisible();
});
const calls = page => page.evaluate(() => instances[0].calls);

test('canvas letters activate the original tools and suppress held repeats', async ({ page }) => {
  const canvas = page.locator('canvas');
  for (const key of ['a', 'r', 'o', 'd', 't']) await canvas.press(key);
  expect((await calls(page)).map(call => call.args[0])).toEqual(['arrow', 'rectangle', 'ellipse', 'diamond', 'text']);
  await canvas.focus();
  await page.keyboard.down('r');
  await page.keyboard.down('r');
  await page.keyboard.up('r');
  expect((await calls(page)).filter(call => call.args[0] === 'rectangle')).toHaveLength(2);
});

test('history and clipboard shortcuts use Ctrl or Meta and the current selection token', async ({ page }) => {
  await page.evaluate(() => { instances[0].setState({ canUndo: true, canRedo: true }); instances[0].select(); });
  const canvas = page.locator('canvas');
  for (const key of ['Control+z', 'Meta+z', 'Control+Shift+z', 'Meta+Shift+z', 'Control+y', 'Meta+y']) await canvas.press(key);
  expect((await calls(page)).filter(call => ['undo', 'redo'].includes(call.method)).map(call => call.method)).toEqual(['undo', 'undo', 'redo', 'redo', 'redo', 'redo']);
  await canvas.press('Control+c');
  await page.evaluate(() => instances[0].select('Shape', { id: 'new-selection' }));
  await canvas.press('Meta+c');
  await canvas.press('Delete');
  await canvas.press('Control+v');
  expect((await calls(page)).filter(call => ['copyToClipboard', 'deleteSelection', 'pasteFromClipboard'].includes(call.method)).map(call => call.method)).toEqual(['copyToClipboard', 'copyToClipboard', 'deleteSelection', 'pasteFromClipboard']);
  const copied = (await calls(page)).filter(call => call.method === 'copyToClipboard');
  expect(copied[1].args[0].version).toBe(copied[0].args[0].version + 1);
  expect((await calls(page)).find(call => call.method === 'deleteSelection').args[0]).toEqual(copied[1].args[0]);
});

test('host inputs, controls, foreign canvases, IME and modified letters retain browser input', async ({ page }) => {
  await page.evaluate(() => {
    for (const tag of ['input', 'textarea', 'select', 'button', 'canvas']) {
      const element = document.createElement(tag); element.id = 'foreign-' + tag; element.tabIndex = 0; document.body.append(element);
    }
    const editable = document.createElement('div'); editable.id = 'foreign-editable'; editable.contentEditable = 'true'; document.body.append(editable);
  });
  for (const target of ['input', 'textarea', 'select', 'button', 'canvas', 'editable']) await page.locator('#foreign-' + target).press('r');
  for (const key of ['Control+r', 'Shift+r', 'Alt+r', 'Meta+r']) {
    await page.locator('canvas').first().dispatchEvent('keydown', { key: 'r', code: 'KeyR', ctrlKey: key.startsWith('Control'), shiftKey: key.startsWith('Shift'), altKey: key.startsWith('Alt'), metaKey: key.startsWith('Meta') });
  }
  await page.locator('canvas').first().dispatchEvent('keydown', { key: 'r', code: 'KeyR', isComposing: true });
  await page.locator('canvas').first().dispatchEvent('keydown', { key: 'Process', code: 'KeyR', keyCode: 229 });
  expect(await calls(page)).toEqual([]);
});

test('disabled tools and active pointer gestures cannot replace an interaction', async ({ page }) => {
  await page.evaluate(() => { instances[0].view.dispose(); instances[0].root.remove(); instances[0] = mount({ buttons: { rectangle: false } }); instances[0].root.querySelector('canvas').tabIndex = 0; });
  await expect(page.getByRole('button', { name: 'Ellipse', exact: true })).toBeVisible();
  await page.locator('canvas').press('r');
  await page.evaluate(() => instances[0].setState({ editingEnabled: false }));
  await page.locator('canvas').press('o');
  await page.evaluate(() => instances[0].setState({ editingEnabled: true, busy: true }));
  await page.locator('canvas').press('o');
  await page.evaluate(() => instances[0].setState({ busy: false }));
  await page.locator('canvas').focus();
  const bounds = await page.locator('canvas').boundingBox();
  await page.mouse.move(bounds.x + 400, bounds.y + 300);
  await page.mouse.down();
  await page.keyboard.press('o');
  await page.mouse.move(bounds.x + bounds.width + 10, bounds.y + bounds.height + 10);
  await page.mouse.up();
  await expect(page.locator('canvas')).toBeFocused();
  expect(await calls(page)).toEqual([]);
  await page.keyboard.press('o');
  expect((await calls(page)).at(-1)).toEqual({ method: 'setTool', args: ['ellipse'] });
});

test('Escape cancels canvas and inline interactions while composition remains untouched', async ({ page }) => {
  await page.evaluate(() => {
    instances[0].setState({ busy: true });
    const input = document.createElement('div'); input.contentEditable = 'plaintext-only'; input.dataset.testid = 'd-canvas-content-editable'; instances[0].root.querySelector('.drawmotive-canvas-host').append(input);
  });
  await page.locator('canvas').press('Escape');
  const inline = page.getByTestId('d-canvas-content-editable');
  await inline.press('Escape');
  await inline.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true });
  expect((await calls(page)).map(call => call.method)).toEqual(['cancelInteraction', 'cancelInteraction']);
});

test('temporary pan and drag modifiers are released when focus leaves the canvas', async ({ page }) => {
  await page.locator('canvas').focus();
  await page.keyboard.down('Space');
  await expect.poll(async () => (await calls(page)).some(call => call.method === 'beginPan')).toBe(true);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).focus();
  await page.keyboard.up('Space');
  await expect.poll(async () => (await calls(page)).filter(call => call.method === 'endPan').length).toBe(1);
  await page.locator('canvas').focus();
  await page.keyboard.down('Alt');
  await page.keyboard.up('Alt');
  expect((await calls(page)).filter(call => call.method === 'updateInteractionModifiers').map(call => call.args[0])).toEqual([{ alt: true, shift: false }, { alt: false, shift: false }]);
  await page.evaluate(() => instances[0].view.dispose());
  const count = (await calls(page)).length;
  await page.keyboard.press('r');
  expect((await calls(page)).length).toBe(count);
});

test('a read-only canvas does not dispatch editing modifier operations', async ({ page }) => {
  await page.evaluate(() => instances[0].setState({ editingEnabled: false }));
  await page.locator('canvas').focus();
  await page.keyboard.press('Shift');
  await page.keyboard.press('Alt');
  expect(await calls(page)).toEqual([]);
});

test('unmount releases a pan whose asynchronous acquisition is still pending', async ({ page }) => {
  await page.evaluate(() => {
    instances[0].editor.beginPan = () => { instances[0].calls.push({ method: 'beginPan', args: [] }); return new Promise(resolve => { globalThis.finishPan = resolve; }); };
  });
  await page.locator('canvas').focus();
  await page.keyboard.down('Space');
  await page.waitForFunction(() => typeof finishPan === 'function');
  await page.evaluate(() => instances[0].view.dispose());
  await page.evaluate(() => finishPan(true));
  await expect.poll(async () => (await calls(page)).filter(call => call.method === 'endPan').length).toBe(1);
  await page.keyboard.up('Space');
  expect((await calls(page)).filter(call => call.method === 'endPan')).toHaveLength(1);
});

test('an acquired Space hold suppresses browser scrolling while native pan is busy', async ({ page }) => {
  await page.locator('canvas').focus();
  await page.keyboard.down('Space');
  await expect.poll(async () => (await calls(page)).some(call => call.method === 'beginPan')).toBe(true);
  await page.evaluate(() => instances[0].setState({ busy: true }));
  const allowedDefault = await page.locator('canvas').evaluate(canvas => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: true, bubbles: true, cancelable: true })));
  expect(allowedDefault).toBe(false);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await calls(page)).filter(call => call.method === 'endPan').length).toBe(1);
});

test('hiding chrome retains keyboard input and text commands submit one generated batch', async ({ page }) => {
  await page.evaluate(() => { instances[0].view.dispose(); instances[0].root.remove(); instances[0] = mount(false); instances[0].root.querySelector('canvas').tabIndex = 0; });
  await page.locator('canvas').press('r');
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual({ method: 'setTool', args: ['rectangle'] });
  await page.evaluate(() => instances[0].select('IndependentText'));
  await page.locator('canvas').press('Control+b');
  await page.locator('canvas').press('Meta+i');
  await page.locator('canvas').press('Enter');
  const edits = (await calls(page)).filter(call => call.method === 'editScene');
  expect(edits.map(call => call.args[0].changes)).toEqual([
    [{ itemId: 'IndependentText', path: ['fontStyle', 'weight'], value: 700 }],
    [{ itemId: 'IndependentText', path: ['fontStyle', 'slant'], value: 'Italic' }],
  ]);
  expect((await calls(page)).at(-1)).toEqual({ method: 'beginTextEditing', args: ['IndependentText'] });
});


test('preserved host canvases and inline lookalikes never own shortcuts', async ({ page }) => {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.id = 'preserved-canvas'; canvas.tabIndex = 0;
    instances[0].root.prepend(canvas);
    const input = document.createElement('div'); input.id = 'preserved-inline'; input.contentEditable = 'true';
    input.dataset.testid = 'd-canvas-content-editable'; instances[0].root.prepend(input);
  });
  await page.locator('#preserved-canvas').press('r');
  await page.locator('#preserved-inline').press('Escape');
  expect(await calls(page)).toEqual([]);
  await page.locator('.drawmotive-canvas-host canvas').press('r');
  expect(await calls(page)).toEqual([{ method: 'setTool', args: ['rectangle'] }]);
});

test('modifiers acquired before canvas focus release without another pointer movement', async ({ page }) => {
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'host-input'; document.body.append(input); });
  for (const key of ['Alt', 'Shift']) {
    await page.locator('#host-input').focus();
    await page.keyboard.down(key);
    await page.locator('.drawmotive-canvas-host canvas').dispatchEvent('pointerdown', { buttons: 1, altKey: key === 'Alt', shiftKey: key === 'Shift' });
    await page.keyboard.up(key);
    await page.locator('.drawmotive-canvas-host canvas').dispatchEvent('pointerup', { buttons: 0 });
  }
  expect((await calls(page)).filter(call => call.method === 'updateInteractionModifiers').map(call => call.args[0])).toEqual([
    { alt: false, shift: false }, { alt: false, shift: false },
  ]);
});

for (const release of ['pointercancel', 'lostpointercapture', 'blur']) test(`interrupted pointer ownership cancels native interaction on ${release}`, async ({ page }) => {
  const canvas = page.locator('.drawmotive-canvas-host canvas');
  await canvas.dispatchEvent('pointerdown', { buttons: 1, pointerId: 7 });
  if (release === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  else await canvas.dispatchEvent(release, { buttons: 0, pointerId: 7 });
  expect((await calls(page)).map(call => call.method)).toEqual(['cancelInteraction']);
  await canvas.press('r');
  expect((await calls(page)).at(-1)).toEqual({ method: 'setTool', args: ['rectangle'] });
});

test('normal pointer capture release preserves Space across two pan drags', async ({ page }) => {
  const canvas = page.locator('.drawmotive-canvas-host canvas');
  await canvas.focus();
  await page.keyboard.down('Space');
  for (let drag = 0; drag < 2; drag++) {
    await canvas.dispatchEvent('pointerdown', { buttons: 1 });
    await canvas.dispatchEvent('pointerup', { buttons: 0 });
    await canvas.dispatchEvent('lostpointercapture', { buttons: 0 });
    expect((await calls(page)).map(call => call.method)).toEqual(['beginPan']);
  }
  await page.keyboard.up('Space');
  await expect.poll(async () => (await calls(page)).map(call => call.method)).toEqual(['beginPan', 'endPan']);
});
