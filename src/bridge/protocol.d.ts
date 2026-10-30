export declare const PROTOCOL_VERSION: 3;
export type EditorErrorCode =
  | 'ProtocolMismatch' | 'InvalidMessage' | 'InvalidRuntimeResponse' | 'EditorDisposed'
  | 'RequestTimeoutUnknown' | 'RequestAborted' | 'RequestAbortedUnknown' | 'StaleDocumentSession' | 'UnknownMethod'
  | 'ReverseCallDuringDocumentCommand'
  | 'RuntimeError' | 'RuntimeUnavailable' | 'HostActionFailed' | 'UnknownAction' | 'ActionUnavailable'
  | 'InvalidDocument' | 'InteractionBusy' | 'StorageConflict' | 'StorageUnavailable'
  | 'ResourceUnavailable' | 'ModuleUnavailable' | 'StartupTimeout' | 'DisposeCleanupUnconfirmed';
export declare const ERROR_CODES: { readonly [Code in EditorErrorCode]: Code };

export interface EditorRequestCompletion<T = unknown> { readonly result?: T; readonly error?: Error; }
export interface EditorErrorDetails {
  requestId?: string;
  instanceId?: string;
  documentSessionId?: string | null;
  method?: string;
  completion?: Promise<EditorRequestCompletion>;
  cause?: unknown;
  [key: string]: unknown;
}
export declare class EditorError extends Error {
  readonly code: EditorErrorCode | (string & {});
  readonly requestId?: string;
  readonly instanceId?: string;
  readonly documentSessionId?: string | null;
  readonly method?: string;
  /** RequestTimeoutUnknown and RequestAbortedUnknown retain a late response,
   * session expiry or disposal outcome. Aborting waiting never retracts a transaction. */
  readonly completion?: Promise<EditorRequestCompletion>;
  constructor(code: EditorErrorCode | (string & {}), message: string, details?: EditorErrorDetails);
}
export interface EditorErrorDescriptor { readonly code: string; readonly message: string; }
export type RuntimeLane = 'document' | 'platform';
export interface RuntimeScope {
  readonly instanceId: string;
  /** Unique for each open document lifetime, even when reopening the same ID. */
  readonly documentSessionId: string | null;
}
export interface RuntimeEnvelope extends RuntimeScope {
  readonly protocolVersion: 3;
  readonly lane: RuntimeLane;
}
export interface RuntimeRequest<Args = unknown> extends RuntimeEnvelope {
  readonly type: 'request';
  readonly requestId: string;
  readonly method: string;
  readonly args: Args;
}
export type RuntimeResponse<Result = unknown> = RuntimeEnvelope & { readonly type: 'response'; readonly requestId: string } & (
  | { readonly result: Result; readonly error?: never }
  | { readonly result?: never; readonly error: EditorErrorDescriptor }
);
export interface RuntimeEvent<Data = unknown> extends RuntimeEnvelope {
  readonly type: 'event';
  readonly name: string;
  readonly data: Data;
}
export type RuntimeMessage = RuntimeRequest | RuntimeResponse | RuntimeEvent;
export declare function immutableSnapshot<T>(value: T): Readonly<T>;
export declare function toErrorDescriptor(error: unknown, fallbackCode?: string): EditorErrorDescriptor;
export declare function fromErrorDescriptor(value: unknown): EditorError;
export declare function assertProtocolMessage(value: unknown): RuntimeMessage;
export declare function isProtocolMessage(value: unknown): value is RuntimeMessage;
export declare function createRequest<Args = Record<string, never>>(options: RuntimeScope & { requestId: string; method: string; args?: Args; lane?: RuntimeLane }): RuntimeRequest<Args>;
export declare function createResponse<Result>(request: RuntimeRequest, outcome: { result: Result; error?: never } | { error: unknown; result?: never }): RuntimeResponse<Result>;
export declare function createEvent<Data>(options: RuntimeScope & { name: string; data: Data; lane?: RuntimeLane }): RuntimeEvent<Data>;
