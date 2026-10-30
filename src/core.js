import { createEditorSession } from './editor-session.js';
export { EditorError } from './errors.js';

/** Standalone public entry: site replication capabilities are never returned here. */
export async function createEditor(options) { return createEditorSession(options); }
