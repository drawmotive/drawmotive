import type { EditorModelValue, EditorSceneChange, EditorSelectedObject, EditorSelectionSnapshot } from '../core.js';
export type UiValue<T> = { readonly state: 'Unavailable' | 'Mixed'; readonly value?: T | null } | { readonly state: 'Uniform'; readonly value: T };
export interface UiColorValue { readonly role: string; readonly argb: number | null; }
/** The built-in toolbar's view, separate from the extensible public model contract. */
export interface UiPropertyValues {
  readonly strokeColor: UiValue<UiColorValue>; readonly fillColor: UiValue<UiColorValue>;
  readonly strokeWidth: UiValue<string>; readonly strokeStyle: UiValue<string>; readonly cornerRadius: UiValue<number>;
  readonly textSize: UiValue<string>; readonly resolvedTextSize: UiValue<number>; readonly bold: UiValue<boolean>; readonly italic: UiValue<boolean>;
  readonly horizontalAlignment: UiValue<string>; readonly verticalAlignment: UiValue<string>;
  readonly lineStartStyle: UiValue<number>; readonly lineEndStyle: UiValue<number>; readonly lineRouting: UiValue<string>;
  readonly groupColorRole: UiValue<string | null>; readonly groupHeaderVisible: UiValue<boolean>;
}
export interface UiSelectedObject extends Omit<EditorSelectedObject, 'boundText'> { readonly properties: UiPropertyValues; readonly boundText?: UiSelectedObject | null; }
export interface UiSelection extends Omit<EditorSelectionSnapshot, 'items'> { readonly items: readonly UiSelectedObject[]; readonly properties: UiPropertyValues; }
export type SelectionEdit = (description: string, changes: (item: UiSelectedObject) => readonly EditorSceneChange[], target?: UiSelectedObject) => Promise<boolean>;
export declare function projectSelection(selection: EditorSelectionSnapshot): UiSelection;
export declare function setModel(item: EditorSelectedObject, path: readonly string[], value: EditorModelValue): EditorSceneChange;
export declare function callModel(item: EditorSelectedObject, method: string, ...args: EditorModelValue[]): EditorSceneChange;
export declare function selectionEdit(selection: UiSelection, description: string, changes: (item: UiSelectedObject) => readonly EditorSceneChange[], target?: UiSelectedObject): import('../core.js').EditorSceneEdit;
