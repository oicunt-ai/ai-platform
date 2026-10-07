import { randomUUID } from 'node:crypto';
import type {
  McpRequestOptions,
  McpTransportPort,
} from '../../application/ports/mcp-transport.port.js';
import type { LegacySseTransportConfig } from '../../domain/types.js';
import { McpConnectionError, McpProtocolError, McpTimeoutError } from '../../domain/errors.js';
import { SsrfGuard } from '../security/ssrf-guard.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timeoutId?: NodeJS.Timeout | undefined;
}

export class LegacySseTransport implements McpTransportPort {
  private connected = false;
  private postUrl: string;
  private readonly sseUrl: string;
  private readonly pendingRequests = new Map<string | number, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Array<(params: unknown) => void>>();
  private readonly closeHandlers: Array<(error?: Error) => void> = [];
  private abortController: AbortController | null = null;

  constructor(
    private readonly config: LegacySseTransportConfig,
    private readonly resolvedSecret?: string | undefined,
    allowLocalhost = false,
  ) {
    const validated = SsrfGuard.validateUrl(config.url, allowLocalhost);
    this.sseUrl = validated.toString();
    this.postUrl = validated.toString();
  }

  public async connect(): Promise<void> {
    if (this.connected) return;

    this.abortController = new AbortController();
    this.connected = true;

    // Start background stream consumer
    void this.consumeSseStream();
  }

  public async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(new McpConnectionError('Transport disconnected'));
      this.pendingRequests.delete(id);
    }

    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {
        // Ignore close handler error
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
    const payload = {
      jsonrpc: '2.0',
      method,
      params,
    };

    try {
      await this.postJsonRpc(payload);
    } catch {
      // Ignored for notifications
    }
  }

  public async sendRequest<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: McpRequestOptions,
  ): Promise<TResult> {
    if (!this.connected) {
      throw new McpConnectionError('Legacy SSE transport is not connected');
    }

    const id = randomUUID();
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<TResult>((resolve, reject) => {
      const timeoutMs = options?.deadlineMs
        ? Math.max(1, options.deadlineMs - Date.now())
        : (this.config.timeoutMs ?? 30000);

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new McpTimeoutError(`SSE request '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          if (timeoutId) clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          reject(new McpConnectionError('Request cancelled by caller'));
        });
      }

      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timeoutId,
      });

      this.postJsonRpc(payload)
        .then((directResponse) => {
          if (directResponse && directResponse.id === id) {
            this.pendingRequests.delete(id);
            if (timeoutId) clearTimeout(timeoutId);
            if (directResponse.error) {
              reject(
                new McpProtocolError(
                  directResponse.error.message,
                  directResponse.error.code,
                  directResponse.error.data,
                ),
              );
            } else {
              resolve(directResponse.result as TResult);
            }
          }
        })
        .catch((err) => {
          if (timeoutId) clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          reject(err);
        });
    });
  }

  private async postJsonRpc(payload: unknown): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.config.headers ?? {}),
    };

    if (this.resolvedSecret) {
      headers['Authorization'] = `Bearer ${this.resolvedSecret}`;
    }

    const res = await fetch(this.postUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new McpConnectionError(`SSE upstream POST returned HTTP ${res.status}`);
    }

    const text = await res.text();
    if (text.trim()) {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
    return null;
  }

  private async consumeSseStream(): Promise<void> {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      ...(this.config.headers ?? {}),
    };
    if (this.resolvedSecret) {
      headers['Authorization'] = `Bearer ${this.resolvedSecret}`;
    }

    try {
      const res = await fetch(this.sseUrl, {
        method: 'GET',
        headers,
        signal: this.abortController ? this.abortController.signal : null,
      });

      if (!res.ok) {
        throw new McpConnectionError(`SSE connection failed with HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (this.connected) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'message';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            this.handleSseEvent(currentEvent, dataStr);
          }
        }
      }
    } catch (err: unknown) {
      if (this.connected) {
        this.connected = false;
        for (const handler of this.closeHandlers) {
          try {
            handler(err instanceof Error ? err : new Error(String(err)));
          } catch {
            // Ignore close handler error
          }
        }
      }
    }
  }

  private handleSseEvent(event: string, dataStr: string): void {
    if (event === 'endpoint') {
      try {
        // SSE handshake endpoint event provides relative or absolute URL for POST requests
        const resolved = new URL(dataStr, this.sseUrl);
        this.postUrl = resolved.toString();
      } catch {
        // Ignore endpoint URL resolution failure
      }
      return;
    }

    try {
      const msg = JSON.parse(dataStr);
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (pending.timeoutId) clearTimeout(pending.timeoutId);
          if (msg.error) {
            pending.reject(new McpProtocolError(msg.error.message, msg.error.code, msg.error.data));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      if (msg.method && this.notificationHandlers.has(msg.method)) {
        for (const h of this.notificationHandlers.get(msg.method)!) {
          try {
            h(msg.params);
          } catch {
            // Ignore notification handler error
          }
        }
      }
    } catch {
      // Ignore SSE data parse error
    }
  }
}
