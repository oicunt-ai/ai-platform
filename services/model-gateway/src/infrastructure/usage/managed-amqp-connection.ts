/**
 * Managed AMQP connection with bounded reconnect, channel lifecycle, and
 * truthful health reporting for metering publication.
 *
 * Responsibilities:
 * - Establish a confirm channel and assert the durable topic exchange.
 * - Detect connection/channel close and errors; invalidate immediately.
 * - Track RabbitMQ blocked/unblocked (flow control) states.
 * - Reconnect with exponential backoff and jitter, single-flight (no
 *   duplicate concurrent reconnect attempts), reasserting the exchange.
 * - Report health truthfully: ready only while a live, unblocked confirm
 *   channel exists. No stale-true after a dropped connection.
 *
 * The broker URL is always supplied by the caller (service config); no
 * credentials are hardcoded here.
 */

export interface ManagedChannel {
  assertExchange(exchange: string, type: string, options?: { durable?: boolean }): Promise<unknown>;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: {
      persistent?: boolean;
      contentType?: string;
      messageId?: string;
      correlationId?: string;
      mandatory?: boolean;
    },
  ): boolean;
  waitForConfirms(): Promise<void>;
  close(): Promise<void>;
  on(event: 'close' | 'error' | 'drain', listener: (reason?: unknown) => void): void;
  on(
    event: 'return',
    listener: (message: { properties?: { messageId?: unknown } | undefined }) => void,
  ): void;
}

export interface ManagedConnection {
  createConfirmChannel(): Promise<ManagedChannel>;
  close(): Promise<void>;
  on(
    event: 'close' | 'error' | 'blocked' | 'unblocked',
    listener: (reason?: unknown) => void,
  ): void;
}

export type AmqpConnectFn = (url: string) => Promise<ManagedConnection>;

export interface ManagedAmqpConnectionOptions {
  /** First reconnect delay. Defaults to 1000ms. */
  readonly initialReconnectDelayMs?: number | undefined;
  /** Upper bound for reconnect delays. Defaults to 30000ms. */
  readonly maxReconnectDelayMs?: number | undefined;
}

export interface ManagedAmqpConnectionStats {
  readonly connected: boolean;
  readonly blocked: boolean;
  readonly reconnectAttempts: number;
  readonly lastError: string | null;
  readonly lastConnectedAt: string | null;
}

import amqplib from 'amqplib';

/** Default production connector (tests inject fakes through ConnectionDeps). */
function defaultConnect(url: string): Promise<ManagedConnection> {
  return amqplib.connect(url);
}

interface ConnectionDeps {
  readonly url: string;
  readonly exchange: string;
  readonly connect?: AmqpConnectFn | undefined;
  readonly options?: ManagedAmqpConnectionOptions | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly onLog?: ((level: 'info' | 'warn' | 'error', message: string) => void) | undefined;
}

const DEFAULT_INITIAL_RECONNECT_MS = 1000;
const DEFAULT_MAX_RECONNECT_MS = 30000;

export class ManagedAmqpConnection {
  private readonly url: string;
  private readonly exchange: string;
  private readonly connectFn: AmqpConnectFn;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onLog: ((level: 'info' | 'warn' | 'error', message: string) => void) | undefined;

  private connection: ManagedConnection | null = null;
  private channel: ManagedChannel | null = null;
  private channelHealthy = false;
  private blocked = false;
  private closed = false;
  private loopStarted = false;
  /** Single-flight guard shared by the loop and event-driven attempts. */
  private attemptPromise: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private lastError: string | null = null;
  private lastConnectedAt: string | null = null;

  constructor(deps: ConnectionDeps) {
    this.url = deps.url;
    this.exchange = deps.exchange;
    this.connectFn = deps.connect ?? defaultConnect;
    this.initialReconnectDelayMs =
      deps.options?.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_MS;
    this.maxReconnectDelayMs = deps.options?.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_MS;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = deps.random ?? Math.random;
    this.onLog = deps.onLog;
  }

  /** Truthful health: live confirm channel, not blocked, not closed. */
  public isReady(): boolean {
    return !this.closed && this.channelHealthy && this.channel !== null && !this.blocked;
  }

  public isBlocked(): boolean {
    return this.blocked;
  }

  public getChannel(): ManagedChannel | null {
    return this.channelHealthy && this.channel !== null && !this.blocked ? this.channel : null;
  }

  public getStats(): ManagedAmqpConnectionStats {
    return {
      connected: this.channelHealthy && this.channel !== null,
      blocked: this.blocked,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
    };
  }

  /**
   * Starts the background connect/reconnect loop. Idempotent and
   * non-blocking: resolves once the loop is running, NOT once connected,
   * so service boot never hangs on a broker outage.
   */
  public start(): void {
    if (this.loopStarted || this.closed) {
      return;
    }
    this.loopStarted = true;
    void this.reconnectLoop();
  }

  public reconnectDelayForAttempt(attempt: number): number {
    const capped = Math.min(
      this.maxReconnectDelayMs,
      this.initialReconnectDelayMs * Math.pow(2, Math.max(0, attempt - 1)),
    );
    return Math.floor(capped * (0.5 + this.random() * 0.5));
  }

  private async reconnectLoop(): Promise<void> {
    while (!this.closed) {
      if (!this.channelHealthy) {
        this.kickAttempt();
        // Waiting here is safe: the shared attempt promise never rejects.
        await this.attemptPromise;
      } else {
        // Healthy: idle until something invalidates the channel.
        await this.sleep(Math.min(this.maxReconnectDelayMs, 5000));
      }
    }
  }

  /**
   * Ensures exactly one connect attempt is in flight. Concurrent callers
   * (loop iteration, close/error events) share it — duplicate concurrent
   * reconnect attempts are impossible by construction.
   */
  private kickAttempt(): void {
    if (this.closed || this.attemptPromise !== null) {
      return;
    }
    this.attemptPromise = this.connectOnce()
      .catch(() => undefined)
      .finally(() => {
        this.attemptPromise = null;
      });
  }

  private async connectOnce(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.reconnectAttempts += 1;
    try {
      const connection = await this.connectFn(this.url);
      if (this.closed) {
        await connection.close().catch(() => {
          // Best effort: shutting down anyway.
        });
        return;
      }
      connection.on('close', () => this.invalidate('connection closed'));
      connection.on('error', (reason) => this.invalidate(describeReason(reason)));
      connection.on('blocked', () => {
        this.blocked = true;
        this.onLog?.('warn', 'RabbitMQ connection blocked by broker (flow control)');
      });
      connection.on('unblocked', () => {
        this.blocked = false;
        this.onLog?.('info', 'RabbitMQ connection unblocked by broker');
      });
      const channel = await connection.createConfirmChannel();
      if (this.closed) {
        await channel.close().catch(() => undefined);
        await connection.close().catch(() => undefined);
        return;
      }
      channel.on('close', () => this.invalidate('channel closed'));
      channel.on('error', (reason) => this.invalidate(describeReason(reason)));
      await channel.assertExchange(this.exchange, 'topic', { durable: true });
      this.connection = connection;
      this.channel = channel;
      this.channelHealthy = true;
      this.blocked = false;
      this.lastError = null;
      this.lastConnectedAt = new Date().toISOString();
      this.onLog?.('info', 'RabbitMQ metering connection established');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.onLog?.(
        'warn',
        `RabbitMQ metering connection attempt ${this.reconnectAttempts} failed; backing off`,
      );
      const delay = this.reconnectDelayForAttempt(this.reconnectAttempts);
      await this.sleep(delay);
    }
  }

  private invalidate(reason: string): void {
    if (!this.channelHealthy && this.channel === null) {
      return;
    }
    this.channelHealthy = false;
    this.channel = null;
    this.lastError = reason;
    this.onLog?.('warn', `RabbitMQ metering connection invalidated: ${reason}`);
    // The background loop picks this up; the event-driven kick covers the
    // case where the loop is idling on its healthy sleep.
    this.kickAttempt();
  }

  /**
   * Idempotent shutdown: stops reconnecting and releases resources.
   * In-flight publishes observe channel close and fail as uncertain
   * (retryable) rather than as confirmed loss.
   */
  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.channelHealthy = false;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}

function describeReason(reason: unknown): string {
  if (reason === undefined || reason === null) {
    return 'unknown reason';
  }
  return reason instanceof Error ? reason.message : String(reason);
}
