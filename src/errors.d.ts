export interface EditorErrorDetails { cause?: unknown; [key:string]: unknown; }
export declare class EditorError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code:string, message:string, details?:EditorErrorDetails);
}
export declare const ERROR_CODES: Readonly<Record<string,string>>;
export declare function immutableSnapshot<T>(value:T, options?:{ readonly transfer?: boolean }):T;
export declare function isBytes(value:unknown):value is Uint8Array;
export declare function exclusiveBuffers(value:unknown):ArrayBuffer[];
export declare function toErrorDescriptor(error:unknown,fallbackCode?:string):Readonly<{code:string;message:string}>;
export declare function fromErrorDescriptor(value:unknown):EditorError;
