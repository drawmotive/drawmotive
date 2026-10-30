import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { EditorCreateOptions, EditorInstance } from '../core.js';
export type { EditorUiOptions, EditorUiAction, EditorRegionId, EditorButtonId } from './ui-options.js';
export interface EditorUiProps {
  editor:EditorInstance;container:HTMLElement;slots?:Readonly<Record<string,ReactNode>>;colorScheme?:'light'|'dark';className?:string;style?:CSSProperties;onError?:(error:unknown)=>void;
}
export interface EditorProps extends Omit<EditorCreateOptions,'container'> {
  className?:string;style?:CSSProperties;slots?:Readonly<Record<string,ReactNode>>;colorScheme?:'light'|'dark';onReady?:(editor:EditorInstance)=>void;onError?:(error:unknown)=>void;
}
/** Options that change the document identity recreate the iframe; memoize object options. */
export declare function Editor(props:EditorProps):ReactElement;
export declare function EditorUi(props:EditorUiProps):ReactElement|null;
export declare function mountEditorUi(props:EditorUiProps):{dispose():void};
