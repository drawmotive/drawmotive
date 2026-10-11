import { test as base, expect } from '@playwright/test';

const test = base.extend({
  host: async ({ page }, use) => {
    const foreignRequests = [];
    const productRequests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:4186') {
        foreignRequests.push(url.href);
        return route.abort();
      }
      if (/(?:analytics|googletag|authentication|account)(?:[/.?]|$)/i.test(url.pathname)
          && !url.pathname.startsWith('/generated/editor/_framework/')) productRequests.push(url.href);
      return route.continue();
    });
    await page.goto('/test/browser/host.html');
    await use(page);
    expect(foreignRequests, 'embedded runtime must work without external network').toEqual([]);
    expect(productRequests, 'disabled site modules must not make account or analytics requests').toEqual([]);
    expect(errors).toEqual([]);
  },
});

async function create(host, options = {}) {
  await host.evaluate(async options => {
    const { createEditor } = await import('/src/index.js');
    const container = document.createElement('div');
    container.className = 'editor';
    document.body.append(container);
    window.editor = await createEditor({ container, assetBaseUrl: '/generated/editor/', ...options });
  }, options);
  return host.frameLocator('iframe');
}

test('host action exports a coherent embedded PNG and replacement restores the complete document', async ({ host }) => {
  await host.evaluate(async () => {
    const { createEditor } = await import('/src/index.js');
    const container = document.createElement('div');
    container.className = 'editor';
    document.body.append(container);
    window.actionResult = null;
    window.editor = await createEditor({
      container, assetBaseUrl: '/generated/editor/',
      ui: { actions: [{ id: 'host.save', label: 'Save snapshot', onInvoke: async ({ editor, signal }) => {
        window.actionResult = await editor.exportSnapshot({ formats: ['raw', 'png', 'svg'], png: { embedDocument: true } });
        window.actionAborted = signal.aborted;
      } }] },
    });
    await editor.replaceTextGraph('A: Alpha\nB: Beta\nA -> B');
  });
  const action = host.frameLocator('iframe').getByTestId('editor-action-host.save');
  await action.click();
  await expect.poll(() => host.evaluate(() => !!window.actionResult), { timeout: 15_000 }).toBe(true);
  await expect(action).toBeEnabled();
  const result = await host.evaluate(async () => {
    const saved = window.actionResult;
    const state = await editor.getState();
    await editor.replaceTextGraph('Different -> Document');
    await editor.replacePngDocument(saved.png.base64);
    const reopened = await editor.exportSnapshot({ formats: ['raw', 'png', 'svg'], png: { embedDocument: true } });
    const reopenedState = await editor.getState();
    await editor.dispose();
    return { saved, state, reopened, reopenedState, actionAborted: window.actionAborted };
  });
  expect(result.saved.revision).toBe(result.state.revision);
  expect(result.actionAborted).toBe(false);
  expect(result.saved.svg).toContain('<svg');
  expect([...Buffer.from(result.saved.png.base64, 'base64').subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result.reopened.raw).toBe(result.saved.raw);
  expect(result.reopened.png).toEqual(result.saved.png);
  expect(result.reopened.svg).toBe(result.saved.svg);
  expect(result.reopened.revision).not.toBe(result.saved.revision);
  expect(result.reopenedState).toMatchObject({ health: 'healthy', canUndo: false, canRedo: false });
});

test('built-in visibility uses public identities and leaves unspecified controls visible', async ({ host }) => {
  const frame = await create(host, { ui: { buttons: { rectangle: false, ellipse: false, undo: false, sketchyMode: false, zoomOut: false, help: true } } });
  for (const id of ['rectangle', 'circle', 'undo', 'sketchy-mode', 'zoom-out']) {
    await expect(frame.getByTestId(`home-toolbar-${id}`)).toHaveCount(0);
  }
  for (const id of ['arrow', 'diamond', 'text', 'redo', 'zoom-in', 'settings', 'help']) {
    await expect(frame.getByTestId(`home-toolbar-${id}`)).toBeVisible();
  }
  await expect(frame.getByTestId('home-toolbar-profile')).toHaveCount(0);
  await expect(frame.getByTestId('home-toolbar-application-menu')).toHaveCount(0);
  await host.evaluate(() => editor.dispose());
});

test('editing gate blocks UI and history while document replacement and export remain available', async ({ host }) => {
  const frame = await create(host);
  await host.evaluate(() => editor.replaceTextGraph('A -> B'));
  await frame.getByTestId('home-toolbar-sketchy-mode').click();
  await expect(frame.getByTestId('home-toolbar-undo')).toBeEnabled();
  const before = await host.evaluate(async () => {
    await editor.setEditingEnabled(false);
    return editor.exportSnapshot({ formats: ['raw', 'png'], png: { embedDocument: true } });
  });
  for (const id of ['undo', 'redo', 'rectangle', 'circle', 'arrow', 'text', 'diamond', 'sketchy-mode']) {
    await expect(frame.getByTestId(`home-toolbar-${id}`)).toBeDisabled();
  }
  await frame.locator('body').press('Control+z');
  await frame.locator('body').press('Delete');
  const result = await host.evaluate(async saved => {
    const errors = [];
    for (const operation of ['undo', 'redo']) {
      try { await editor[operation](); } catch (error) { errors.push(error.code); }
    }
    const afterKeyboard = await editor.exportSnapshot({ formats: ['raw'] });
    await editor.clearDocument();
    await editor.replacePngDocument(saved.png.base64);
    await editor.fitViewport();
    const restored = await editor.exportSnapshot({ formats: ['raw'] });
    const disabled = await editor.getState();
    await editor.setEditingEnabled(true);
    return { errors, afterKeyboard, restored, disabled };
  }, before);
  expect(result.errors).toEqual(['EditingDisabled', 'EditingDisabled']);
  expect(result.afterKeyboard.raw).toBe(before.raw);
  expect(result.afterKeyboard.revision).toBe(before.revision);
  expect(result.restored.raw).toBe(before.raw);
  expect(result.disabled).toMatchObject({ health: 'healthy', editingEnabled: false, canUndo: false, canRedo: false });
  await expect(frame.getByTestId('home-toolbar-sketchy-mode')).toBeEnabled();
  await frame.getByTestId('home-toolbar-sketchy-mode').click();
  await expect(frame.getByTestId('home-toolbar-undo')).toBeEnabled();
  expect(await host.evaluate(async () => (await editor.getState()).revision)).not.toBe(result.restored.revision);
  await frame.locator('body').press('Control+z');
  await expect.poll(() => host.evaluate(() => editor.exportSnapshot({ formats: ['raw'] }).then(snapshot => snapshot.raw))).toBe(before.raw);
  await host.evaluate(() => editor.dispose());
});

test('two instances isolate documents, revisions, events and temporary databases through disposal', async ({ host }) => {
  const initial = await host.evaluate(async () => {
    const { createEditor } = await import('/src/index.js');
    const databases = (await indexedDB.databases()).map(database => database.name);
    const containers = [0, 1].map(index => {
      const container = document.createElement('div');
      container.id = `editor-${index}`;
      container.className = 'editor';
      document.body.append(container);
      return container;
    });
    window.editors = await Promise.all(containers.map(container => createEditor({ container, assetBaseUrl: '/generated/editor/' })));
    await Promise.all([editors[0].replaceTextGraph('Left -> Alpha'), editors[1].replaceTextGraph('Right -> Beta')]);
    window.states = [[], []];
    editors.forEach((editor, index) => editor.onStateChanged(state => states[index].push(state)));
    return { databases, snapshots: await Promise.all(editors.map(editor => editor.exportSnapshot({ formats: ['raw'] }))) };
  });
  expect(initial.snapshots[0].raw).not.toBe(initial.snapshots[1].raw);
  expect(initial.snapshots[0].revision).not.toBe(initial.snapshots[1].revision);
  const ids = await Promise.all(host.frames().filter(frame => frame.url().includes('/embed.html')).map(frame => frame.evaluate(() => drawmotiveEmbed.getDrawingId())));
  expect(new Set(ids).size).toBe(2);
  expect(ids.every(id => id.startsWith('drawmotive-embed-'))).toBe(true);
  await expect.poll(() => host.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toEqual(expect.arrayContaining(ids));
  await host.frameLocator('#editor-0 iframe').getByTestId('home-toolbar-sketchy-mode').click();
  await expect(host.frameLocator('#editor-0 iframe').getByTestId('home-toolbar-undo')).toBeEnabled();
  const changed = await host.evaluate(async () => ({ snapshots: await Promise.all(editors.map(editor => editor.exportSnapshot({ formats: ['raw'] }))), states }));
  expect(changed.snapshots[0].raw).not.toBe(initial.snapshots[0].raw);
  expect(changed.snapshots[0].revision).not.toBe(initial.snapshots[0].revision);
  expect(changed.snapshots[1]).toEqual(initial.snapshots[1]);
  expect(changed.states[0].some(state => state.revision === changed.snapshots[0].revision)).toBe(true);
  expect(changed.states[1].every(state => state.revision === initial.snapshots[1].revision)).toBe(true);
  await host.evaluate(() => editors[0].dispose());
  await expect(host.locator('#editor-0 iframe')).toHaveCount(0);
  await expect(host.frameLocator('#editor-1 iframe').getByTestId('dcanvas')).toBeVisible();
  expect(await host.evaluate(() => editors[1].exportSnapshot({ formats: ['raw'] }))).toEqual(initial.snapshots[1]);
  await expect.poll(() => host.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).not.toContain(ids[0]);
  expect(await host.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toContain(ids[1]);
  await host.evaluate(() => editors[1].dispose());
  await expect.poll(() => host.evaluate(async () => (await indexedDB.databases()).map(database => database.name).filter(name => !initial.databases.includes(name)), initial)).toEqual([]);
});

for (const modules of [{ analytics: true }, { authentication: true }, { authentication: true, remoteSync: true }]) {
  test(`unavailable modules reject startup before optional services run: ${Object.keys(modules).join(', ')}`, async ({ host }) => {
    const result = await host.evaluate(async modules => {
      const { createEditor } = await import('/src/index.js');
      const container = document.createElement('div');
      container.className = 'editor';
      document.body.append(container);
      try {
        const editor = await createEditor({ container, assetBaseUrl: '/generated/editor/', modules });
        await editor.dispose();
        return { rejected: false };
      } catch (error) { return { rejected: true, code: error.code, message: error.message, frames: container.querySelectorAll('iframe').length }; }
    }, modules);
    expect(result.rejected).toBe(true);
    expect(result.message).toContain('does not include optional site modules');
    expect(result.frames).toBe(0);
  });
}
