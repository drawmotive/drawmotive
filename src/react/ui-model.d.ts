import type { EditorSelectedObject, EditorScreenBounds } from '../core.js';
import type { NormalizedUiOptions } from './ui-options.js';
export declare const CONTEXT_TOOL_IDS: readonly string[];
export declare const CONTEXT_PANEL_IDS: readonly string[];
export declare function selectionSubjects(items: readonly EditorSelectedObject[]): readonly EditorSelectedObject[];
export declare function contextTools(items: readonly EditorSelectedObject[], options: NormalizedUiOptions['contextToolbar']): string[];
export declare function placeFloating(anchor: EditorScreenBounds, size: {width:number;height:number}, viewport: {width:number;height:number}): {left:number;top:number};
export declare function mapCanvasBounds(bounds: EditorScreenBounds, canvas: EditorScreenBounds & {width:number;height:number}, canvasSize: {width:number;height:number}, host: EditorScreenBounds & {width:number;height:number}, hostSize: {width:number;height:number}): EditorScreenBounds;
