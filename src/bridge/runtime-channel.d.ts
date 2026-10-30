import type { RuntimeEvent, RuntimeLane, RuntimeScope } from './protocol.js';

/** MessagePort and Dedicated Worker transports share this small boundary. */
export interface RuntimePort {
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void;
  start?(): void;
  close?(): void;
}
export interface RuntimeRequestContext extends RuntimeScope {
  readonly requestId: string;
  readonly lane: RuntimeLane;
  readonly method: string;
  /** Aborted only by document-session expiry or channel disposal, never by a
   * caller stopping its wait. Handlers must verify this before a document commit. */
  readonly signal: AbortSignal;
}
export interface RuntimeRequestOptions {
  lane?: RuntimeLane;
  timeoutMs?: number;
  /** Before dispatch rejects RequestAborted. After dispatch rejects
   * RequestAbortedUnknown with completion; the remote transaction may finish. */
  signal?: AbortSignal;
  /** Platform lane only. Explicitly asserts pure storage/resource work that never
   * invokes a host action or calls a document command. Defaults to false. Required
   * while serving a document handler to prevent a callback reentering its queue. */
  documentSafe?: boolean;
}
export interface RuntimeChannel extends RuntimeScope {
  readonly disposed: boolean;
  request<Result = unknown>(method: string, args?: unknown, options?: RuntimeRequestOptions): Promise<Result>;
  onRequest<Args = unknown, Result = unknown>(method: string, handler: (args: Args, context: RuntimeRequestContext) => Result | Promise<Result>, options?: { lane?: RuntimeLane }): () => void;
  onEvent<Data = unknown>(name: string, listener: (data: Data, event: RuntimeEvent<Data>) => void): () => void;
  emit(name: string, data?: unknown, options?: { lane?: RuntimeLane }): void;
  /** Expires previous pending/queued work and aborts active callbacks. IDs must be unique. */
  setDocumentSession(documentSessionId: string | null): void;
  /** Synchronous and idempotent; never waits for a platform callback to finish. */
  dispose(reason?: Error): void;
}
export declare function createRuntimeChannel(options: {
  port: RuntimePort;
  instanceId: string;
  documentSessionId?: string | null;
  requestTimeoutMs?: number;
  /** Document response replay cache only; platform responses are never retained. Defaults to 128. */
  maxCachedResponses?: number;
  /** Total approximate retained payload bytes. Defaults to 1 MiB. Zero disables replay caching. */
  maxCachedResponseBytes?: number;
  onError?: (error: unknown) => void;
}): RuntimeChannel;
