import type { EditorButtonId, EditorRegionId, DrawingToolId, EditorUiOptions, NormalizedUiConfiguration } from './ui-options.js';

export declare const EDITOR_BUTTON_IDS: readonly EditorButtonId[];
export declare const EDITOR_REGION_IDS: readonly EditorRegionId[];
export declare const DRAWING_TOOL_IDS: readonly DrawingToolId[];
export declare function normalizeUiOptions(options?: EditorUiOptions | false): NormalizedUiConfiguration;
