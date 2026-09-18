import { initializeEditor, type EditorDocument } from '@drawmotive/editor';
import { initializeEditor as browserEditor } from '@drawmotive/editor/browser';

async function mount(container: HTMLElement) {
  const editor = await initializeEditor({ container, assetBaseUrl: '/editor/', source: 'A -> B' });
  const result: EditorDocument = await editor.exportDocument();
  await editor.importDocument(result.raw);
  await editor.importTextGraph('B -> C');
  await editor.dispose();
}
void mount;
void browserEditor;
// @ts-expect-error A mount container is required.
initializeEditor({ source: 'A -> B' });
