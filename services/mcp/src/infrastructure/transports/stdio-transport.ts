import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type {
  McpRequestOptions,
  McpTransportPort,
} from '../../application/ports/mcp-transport.port.js';
import type { StdioTransportConfig } from '../../domain/types.js';
import { McpConnectionError, McpProtocolError, McpTimeoutError } from '../../domain/errors.js';
import {
  validateStdioCommand,
  validateStdioArgs,
  buildSanitizedEnvironment,
} from '../security/stdio-guard.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timeoutId?: NodeJS.Timeout | undefined;
}

export class StdioTransport implements McpTransportPort {
  private childProcess: ChildProcess | null = null;
  private readlineInterface: Interface | null = null;
  private isAlive = false;
  private readonly pendingRequests = new Map<string | number, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Array<(params: unknown) => void>>();
  private readonly closeHandlers: Array<(error?: Error) => void> = [];

  constructor(
    private readonly config: StdioTransportConfig,
    allowedExecutables?: readonly string[] | undefined,
  ) {
    validateStdioCommand(config.command, allowedExecutables);
    validateStdioArgs(config.args);
  }

  public async connect(): Promise<void> {
    if (this.isAlive && this.childProcess) {
      return;
    }

    try {
      const isolatedEnv = buildSanitizedEnvironment(this.config.env);

      this.childProcess = spawn(
        this.config.command,
        this.config.args ? [...this.config.args] : [],
        {
          cwd: this.config.cwd,
          env: isolatedEnv,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      this.isAlive = true;

      if (!this.childProcess.stdout || !this.childProcess.stdin) {
        throw new McpConnectionError('Failed to initialize stdio pipes for child process');
      }

      this.readlineInterface = createInterface({
        input: this.childProcess.stdout,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      this.readlineInterface.on('line', (line: string) => {
        this.handleIncomingLine(line);
      });

      this.childProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim();
        if (text) {
          // Log stderr output without failing transport
        }
      });

      this.childProcess.on('exit', (code, signal) => {
        this.handleProcessExit(code, signal);
      });

      this.childProcess.on('error', (err) => {
        this.handleProcessError(err);
      });
    } catch (err: unknown) {
      this.isAlive = false;
      throw new McpConnectionError(
        `Failed to spawn stdio child process '${this.config.command}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.childProcess || !this.isAlive) {
      return;
    }

    this.isAlive = false;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(new McpConnectionError('Transport disconnected'));
      this.pendingRequests.delete(id);
    }

    const proc = this.childProcess;
    this.childProcess = null;

    if (this.readlineInterface) {
      this.readlineInterface.close();
      this.readlineInterface = null;
    }

    // Graceful teardown: SIGTERM followed by 5s hard SIGKILL
    try {
      proc.kill('SIGTERM');
    } catch {
      // Ignore process termination error
    }

    const forceKillTimer = setTimeout(() => {
      try {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch {
        // Ignore force-kill error
      }
    }, 5000);

    proc.once('exit', () => {
      clearTimeout(forceKillTimer);
    });

    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {
        // Ignore close handler error
      }
    }
  }

  public isConnected(): boolean {
    return this.isAlive && this.childProcess !== null;
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
    if (!this.isConnected() || !this.childProcess?.stdin) {
      throw new McpConnectionError('Stdio transport is not connected');
    }

    const msg = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });

    this.childProcess.stdin.write(msg + '\n');
  }

  public async sendRequest<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: McpRequestOptions,
  ): Promise<TResult> {
    if (!this.isConnected() || !this.childProcess?.stdin) {
      throw new McpConnectionError('Stdio transport is not connected');
    }

    const id = randomUUID();
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise<TResult>((resolve, reject) => {
      const timeoutMs = options?.deadlineMs ? Math.max(1, options.deadlineMs - Date.now()) : 30000;

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new McpTimeoutError(`Stdio request '${method}' timed out after ${timeoutMs}ms`));
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

      this.childProcess!.stdin!.write(msg + '\n', (err) => {
        if (err) {
          if (timeoutId) clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          reject(new McpConnectionError(`Failed to write to stdio stdin: ${err.message}`, err));
        }
      });
    });
  }

  private handleIncomingLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed);

      // Handle response to a pending request
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

      // Handle server notification
      if (msg.method && this.notificationHandlers.has(msg.method)) {
        const handlers = this.notificationHandlers.get(msg.method)!;
        for (const handler of handlers) {
          try {
            handler(msg.params);
          } catch {
            // Ignore notification handler error
          }
        }
      }
    } catch {
      // Non-JSON line ignored
    }
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.isAlive = false;
    const error = new McpConnectionError(
      `Stdio child process exited with code ${code}, signal ${signal}`,
    );

    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }

    for (const handler of this.closeHandlers) {
      try {
        handler(error);
      } catch {
        // Ignore close handler error
      }
    }
  }

  private handleProcessError(err: Error): void {
    this.isAlive = false;
    const error = new McpConnectionError(`Stdio child process error: ${err.message}`, err);

    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }

    for (const handler of this.closeHandlers) {
      try {
        handler(error);
      } catch {
        // Ignore close handler error
      }
    }
  }
}
