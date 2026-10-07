import { randomUUID } from 'node:crypto';
import type {
  McpRequestOptions,
  McpTransportPort,
} from '../../application/ports/mcp-transport.port.js';
import type { StreamableHttpTransportConfig } from '../../domain/types.js';
import { McpConnectionError, McpProtocolError, McpTimeoutError } from '../../domain/errors.js';
import { SsrfGuard } from '../security/ssrf-guard.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | undefined;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class StreamableHttpTransport implements McpTransportPort {
  private connected = false;
  private sessionId?: string | undefined;
  private readonly targetUrl: string;
  private readonly notificationHandlers = new Map<string, Array<(params: unknown) => void>>();
  private readonly closeHandlers: Array<(error?: Error) => void> = [];

  constructor(
    private readonly config: StreamableHttpTransportConfig,
    private readonly resolvedSecret?: string | undefined,
    allowLocalhost = false,
  ) {
    // Validate target URL against SSRF policy at creation
    const validated = SsrfGuard.validateUrl(config.url, allowLocalhost);
    this.targetUrl = validated.toString();
  }

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    this.sessionId = undefined;
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {
        // Ignore handler error on close
      }
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public onNotification(method: string, handler: (params: unknown) => void): void {
    const list = this.notificationHandlers.get(method) ?? [];
    list.push(handler);
    this.notificationHandlers.set(method, list);
  }

  public onClose(handler: (error?: Error) => void): void {
    this.closeHandlers.push(handler);
  }

  public async sendNotification(method: string, params?: unknown): Promise<void> {
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
    };

    try {
      await this.postJsonRpc(payload);
    } catch {
      // JSON-RPC notifications do not expect responses or propagate delivery failure
    }
  }

  public async sendRequest<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: McpRequestOptions,
  ): Promise<TResult> {
    if (!this.connected) {
      throw new McpConnectionError('Transport is not connected');
    }

    const id = randomUUID();
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const response = await this.postJsonRpc(payload, options);
    if (!response) {
      throw new McpProtocolError('Empty response received from MCP server');
    }

    if (response.error) {
      throw new McpProtocolError(response.error.message, response.error.code, response.error.data);
    }

    return response.result as TResult;
  }

  private async postJsonRpc(
    payload: JsonRpcRequest,
    options?: McpRequestOptions,
  ): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream, application/x-ndjson',
      ...(this.config.headers ?? {}),
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }
    if (this.resolvedSecret) {
      headers['Authorization'] = `Bearer ${this.resolvedSecret}`;
    }

    const abortController = new AbortController();
    const timeoutMs = options?.deadlineMs
      ? Math.max(1, options.deadlineMs - Date.now())
      : (this.config.timeoutMs ?? 30000);

    const timeoutId = setTimeout(() => {
      abortController.abort(new McpTimeoutError(`HTTP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        abortController.abort(options.signal?.reason);
      });
    }

    try {
      const res = await fetch(this.targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      // Update session ID if header is present
      const newSessionId = res.headers.get('Mcp-Session-Id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      if (!res.ok) {
        throw new McpConnectionError(
          `MCP server returned HTTP ${res.status}: ${res.statusText}`,
          res.status,
        );
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        return await this.handleSseResponseStream(res);
      }

      const text = await res.text();
      if (!text.trim()) {
        return null;
      }

      return JSON.parse(text) as JsonRpcResponse;
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        if (options?.signal?.aborted) {
          throw new McpConnectionError('Request cancelled by caller', err);
        }
        throw new McpTimeoutError(`Request timed out after ${timeoutMs}ms`, err);
      }
      if (
        err instanceof McpTimeoutError ||
        err instanceof McpProtocolError ||
        err instanceof McpConnectionError
      ) {
        throw err;
      }
      throw new McpConnectionError(
        `Network transport error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async handleSseResponseStream(res: Response): Promise<JsonRpcResponse | null> {
    const text = await res.text();
    const lines = text.split('\n');
    let lastResponse: JsonRpcResponse | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.method && this.notificationHandlers.has(parsed.method)) {
            for (const h of this.notificationHandlers.get(parsed.method)!) {
              try {
                h(parsed.params);
              } catch {
                // Ignore notification handler failure
              }
            }
          }
          if (parsed.result !== undefined || parsed.error !== undefined) {
            lastResponse = parsed as JsonRpcResponse;
          }
        } catch {
          // Ignore invalid JSON stream chunks
        }
      }
    }

    return lastResponse;
  }
}
