import type { McpServerRegistration } from '../../domain/types.js';

export interface McpRequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly deadlineMs?: number | undefined;
}

export interface McpTransportPort {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  sendRequest<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: McpRequestOptions,
  ): Promise<TResult>;
  sendNotification(method: string, params?: unknown): Promise<void>;
  onNotification(method: string, handler: (params: unknown) => void): void;
  onClose(handler: (error?: Error) => void): void;
}

export interface McpTransportFactoryPort {
  createTransport(
    registration: McpServerRegistration,
    resolvedSecret?: string | undefined,
  ): Promise<McpTransportPort>;
}
