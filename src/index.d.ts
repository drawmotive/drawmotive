export * from './core.js';
import type { EditorCreateOptions, EditorInstance } from './core.js';
/** Full React/Mantine UI. The host must import @drawmotive/editor/styles.css.
 * Use @drawmotive/editor/core to omit React and chrome entirely. */
export declare function createEditor(options:EditorCreateOptions):Promise<EditorInstance>;
