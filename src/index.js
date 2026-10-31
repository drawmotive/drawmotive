import { createEditor as createCoreEditor, EditorError } from './core.js';
export { EditorError };

/** Full imperative entry. Import @drawmotive/editor/styles.css once in the host. */
export async function createEditor(options) {
  const editor = await createCoreEditor(options);
  const signal = options?.signal;
  let removeAbort = () => {};
  try {
    signal?.throwIfAborted();
    // Hidden chrome still needs React's Mantine input owner.
    const loading = import('../dist/editor-ui.js');
    const aborted = signal && new Promise((_,reject) => {
      const abort = () => reject(signal.reason ?? new DOMException('Initialization aborted','AbortError'));
      signal.addEventListener('abort',abort,{once:true});removeAbort = () => signal.removeEventListener('abort',abort);
      if (signal.aborted) abort();
    });
    const { mountEditorUi } = await (aborted ? Promise.race([loading,aborted]) : loading);
    signal?.throwIfAborted();
    if (editor.lifecycle !== 'ready') throw new EditorError('EditorDisposed','Editor closed before its UI was ready.');
    mountEditorUi({ editor, container: options.container });
    signal?.throwIfAborted();
    return editor;
  } catch (error) {
    await editor.dispose().catch(() => {});
    throw error;
  } finally { removeAbort(); }
}
