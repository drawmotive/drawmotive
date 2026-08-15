/** Initializes TextGraph before loading the editor-only WASM runtime. */
export async function initializeEditorRuntime(options) {
  const textgraph = await options.initializeTextGraph(options.textGraphOptions);
  try {
    const editor = await options.loadEditorRuntime(options.editorOptions);
    return { textgraph, editor };
  } catch (error) {
    await textgraph.dispose?.();
    throw error;
  }
}
