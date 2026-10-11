import type { UsageEvent } from '@oicunt-ai/usage-types';
import type { UsagePublisherPort } from '../../application/ports/usage-publisher.port.js';
import type { OutboxSenderPort } from './outbox/outbox-drainer.js';
import { ManagedAmqpConnection, type ManagedChannel } from './managed-amqp-connection.js';
import { UsagePublishError, UsageUnroutableError } from './publish-errors.js';

export interface RabbitMqUsagePublisherOptions {
  /** Upper bound for a single broker confirmation. Defaults to 10000ms. */
  readonly confirmTimeoutMs?: number | undefined;
  /** Upper bound waiting for channel drain on a full write buffer. Defaults to 5000ms. */
  readonly drainTimeoutMs?: number | undefined;
}

interface PendingSend {
  readonly eventId: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

interface PublisherDeps {
  readonly url: string;
  readonly exchange: string;
  readonly options?: RabbitMqUsagePublisherOptions | undefined;
  readonly connection?: ManagedAmqpConnection | undefined;
}

const ROUTING_KEY = 'usage.v1.model.completion';
const DEFAULT_CONFIRM_TIMEOUT_MS = 10000;
const DEFAULT_DRAIN_TIMEOUT_MS = 5000;

/**
 * Production-grade RabbitMQ publisher for metering events.
 *
 * Delivery guarantees:
 * - Durable topic exchange (reasserted after every reconnect).
 * - Persistent messages (delivery-mode 2) with explicit mandatory routing.
 * - Publisher confirms per send; a basic.return for our messageId rejects
 *   with UsageUnroutableError (permanent: quarantine, never retry-blindly).
 * - Bounded confirmation timeouts; timeouts, channel/connection loss, and
 *   broker flow-control all reject with retryable UsagePublishError —
 *   uncertain delivery is ALWAYS treated as retryable with the original
 *   event identity, never as confirmed loss.
 * - Concurrent sends are serialized through one confirm channel so each
 *   confirmation/return correlates to exactly one event via messageId.
 * - Reconnection is owned by ManagedAmqpConnection (backoff, jitter,
 *   single-flight, exchange reassert). Sends fast-fail while disconnected;
 *   the outbox drainer's backoff governs retry cadence.
 * - Idempotent close(): pending sends reject retryable, resources release,
 *   further sends reject immediately.
 *
 * The broker URL comes from service config only; no credentials are
 * hardcoded here.
 */
export class RabbitMqUsagePublisher implements UsagePublisherPort, OutboxSenderPort {
  private readonly url: string;
  private readonly exchange: string;
  private readonly confirmTimeoutMs: number;
  private readonly drainTimeoutMs: number;
  private readonly connection: ManagedAmqpConnection;
  private readonly pending = new Map<string, PendingSend>();
  private sendChain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(url: string, exchange: string, options?: RabbitMqUsagePublisherOptions | undefined);
  constructor(deps: PublisherDeps);
  constructor(
    urlOrDeps: string | PublisherDeps,
    exchange?: string,
    options?: RabbitMqUsagePublisherOptions | undefined,
  ) {
    if (typeof urlOrDeps === 'string') {
      this.url = urlOrDeps;
      this.exchange = exchange ?? 'oicunt.usage';
      this.confirmTimeoutMs = options?.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
      this.drainTimeoutMs = options?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
      this.connection = new ManagedAmqpConnection({
        url: this.url,
        exchange: this.exchange,
      });
    } else {
      this.url = urlOrDeps.url;
      this.exchange = urlOrDeps.exchange;
      this.confirmTimeoutMs = urlOrDeps.options?.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
      this.drainTimeoutMs = urlOrDeps.options?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
      this.connection =
        urlOrDeps.connection ??
        new ManagedAmqpConnection({
          url: this.url,
          exchange: this.exchange,
        });
    }
  }

  /**
   * Best-effort start: launches the background connect loop and returns
   * WITHOUT waiting for the broker, so service boot never hangs on a
   * broker outage. Delivery of already-captured events is recovered by
   * the outbox drainer once connectivity returns.
   */
  async start(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.connection.start();
  }

  isReady(): boolean {
    return !this.closed && this.connection.isReady();
  }

  isBlocked(): boolean {
    return this.connection.isBlocked();
  }

  public getConnectionStats(): {
    connected: boolean;
    blocked: boolean;
    reconnectAttempts: number;
    lastError: string | null;
    lastConnectedAt: string | null;
  } {
    return this.connection.getStats();
  }

  async publish(event: UsageEvent): Promise<void> {
    return this.send(event);
  }

  async send(event: UsageEvent): Promise<void> {
    if (this.closed) {
      throw new UsagePublishError(event.eventId, 'publisher is closed');
    }
    this.connection.start();
    const channel = this.connection.getChannel();
    if (!channel) {
      throw new UsagePublishError(
        event.eventId,
        this.connection.isBlocked() ? 'broker connection is blocked' : 'broker unavailable',
      );
    }
    // Serialize through one confirm channel so waitForConfirms and
    // basic.return correlate to exactly this event.
    const run = this.sendChain.then(() => this.sendOnChannel(channel, event));
    // The chain itself must never reject (else later sends stall forever).
    this.sendChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async sendOnChannel(channel: ManagedChannel, event: UsageEvent): Promise<void> {
    if (this.closed) {
      throw new UsagePublishError(event.eventId, 'publisher is closed');
    }
    const body = Buffer.from(JSON.stringify(event));
    let published: boolean;
    try {
      published = channel.publish(this.exchange, ROUTING_KEY, body, {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        correlationId: event.lineage.correlationId,
        mandatory: true,
      });
    } catch (error) {
      throw new UsagePublishError(
        event.eventId,
        `publish call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!published) {
      await this.waitForDrainOrClose(channel, event.eventId);
    }

    return new Promise<void>((resolve, reject) => {
      const entry: PendingSend = { eventId: event.eventId, resolve, reject };
      this.pending.set(event.eventId, entry);
      const settle = (fn: () => void): void => {
        if (this.pending.get(event.eventId) === entry) {
          this.pending.delete(event.eventId);
        }
        fn();
      };
      const onReturn = (): void => {
        settle(() =>
          reject(
            new UsageUnroutableError(
              event.eventId,
              'broker returned the message as unroutable under mandatory publishing',
            ),
          ),
        );
      };
      const onClose = (): void => {
        settle(() =>
          reject(
            new UsagePublishError(
              event.eventId,
              'channel closed before broker confirmation (delivery uncertain)',
            ),
          ),
        );
      };
      channel.on('return', (message) => {
        if (message.properties?.messageId === event.eventId) {
          onReturn();
        }
      });
      channel.on('close', onClose);
      const timer = setTimeout(() => {
        onCloseTimeout();
      }, this.confirmTimeoutMs);
      // Never hold the process open for a confirmation wait: explicit
      // close() and the outbox drainer own shutdown sequencing.
      timer.unref?.();
      const onCloseTimeout = (): void => {
        settle(() =>
          reject(
            new UsagePublishError(
              event.eventId,
              `broker confirmation timed out after ${this.confirmTimeoutMs}ms (delivery uncertain)`,
            ),
          ),
        );
      };
      void channel
        .waitForConfirms()
        .then(() => {
          clearTimeout(timer);
          settle(() => resolve());
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          settle(() =>
            reject(
              new UsagePublishError(
                event.eventId,
                `broker confirmation failed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            ),
          );
        });
    });
  }

  private async waitForDrainOrClose(channel: ManagedChannel, eventId: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new UsagePublishError(eventId, 'write buffer drain timed out'));
      }, this.drainTimeoutMs);
      timer.unref?.();
      channel.on('drain', () => {
        clearTimeout(timer);
        resolve();
      });
      channel.on('close', () => {
        clearTimeout(timer);
        reject(new UsagePublishError(eventId, 'channel closed while write buffer full'));
      });
    });
  }

  /**
   * Idempotent shutdown. In-flight sends reject as retryable (uncertain
   * delivery → outbox replay with stable identity); the managed connection
   * (owned by this publisher) is released.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [, entry] of this.pending) {
      entry.reject(new UsagePublishError(entry.eventId, 'publisher closed during send'));
    }
    this.pending.clear();
    await this.connection.close();
  }
}
