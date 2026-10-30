import { createEditor, EditorError, type EditorSnapshot, type EditorState } from '@drawmotive/editor';
import { createEditor as browserEditor } from '@drawmotive/editor/browser';

async function mount(container: HTMLElement) {
  const editor = await createEditor({ container, assetBaseUrl: '/editor/', ui: {
    buttons: { help: false }, actions: [{ id: 'host.save', label: 'Save', async onInvoke({ editor, signal }) {
      await editor.exportSnapshot({ formats: ['png'], png: { embedDocument: true } });
      signal.throwIfAborted();
    } }],
  } });
  const state: EditorState = await editor.getState();
  const unsubscribe = editor.onStateChanged(next => { void next.revision; });
  const result: EditorSnapshot = await editor.exportSnapshot({ formats: ['raw', 'png', 'svg'], render: { scale: 2 } });
  await editor.replaceDocument(result.raw!);
  await editor.replacePngDocument(result.png!.base64);
  await editor.replaceTextGraph('B -> C');
  const scene = await editor.getScene();
  await editor.editScene({revision:scene.revision,description:'Update document',changes:[{path:['title'],value:'Example'},
    ...scene.items.map(item => ({itemId:item.id,path:['xData','custom:label'],value:'Host annotation'}))]});
  // @ts-expect-error Property-specific commands are not part of the SDK.
  editor.setProperty({}, {});
  await editor.fitViewport({ padding: 60 });
  await editor.setEditingEnabled(false);
  await editor.setActionState('host.save', { enabled: false });
  await editor.clearDocument();
  await editor.undo();
  await editor.redo();
  unsubscribe();
  await editor.dispose();
  void state;
}
void mount;
void browserEditor;
void EditorError;
// @ts-expect-error A mount container is required.
createEditor({});
// @ts-expect-error Unknown buttons are not public capabilities.
createEditor({ container: document.body, ui: { buttons: { save: true } } });
// @ts-expect-error Product identity is not an editor option.
createEditor({ container: document.body, product: 'vscode' });
