/**
 * In-memory AMQP doubles for publisher/connection tests. No broker is ever
 * contacted. The fakes reproduce the exact semantics the production code
 * depends on: confirms, mandatory returns correlated by messageId, channel
 * close invalidation, and connect-failure sequencing.
 */
import type {
  ManagedChannel,
  ManagedConnection,
} from '../../src/infrastructure/usage/managed-amqp-connection.js';

export interface PublishedMessage {
  readonly exchange: string;
  readonly routingKey: string;
  readonly body: Buffer;
  readonly options:
    | {
        persistent?: boolean;
        contentType?: string;
        messageId?: string;
        correlationId?: string;
        mandatory?: boolean;
      }
    | undefined;
}

export class FakeAmqpChannel {
  public published: PublishedMessage[] = [];
  public assertExchangeCalls: Array<{ exchange: string; type: string }> = [];
  public closed = false;
  public publishReturnValue = true;
  /** 'confirm' resolves waitForConfirms; 'never' leaves it pending; 'reject' fails it. */
  public confirmBehavior: 'confirm' | 'never' | 'reject' = 'confirm';
  /** When confirmMode is 'manual', each waitForConfirms parks until confirmNext(). */
  public confirmMode: 'auto' | 'manual' = 'auto';
  private confirmResolvers: Array<() => void> = [];
  private readonly listeners = new Map<string, Array<(arg?: unknown) => void>>();

  async assertExchange(
    exchange: string,
    type: string,
    options?: { durable?: boolean },
  ): Promise<unknown> {
    this.assertExchangeCalls.push({ exchange, type });
    void options;
    return {};
  }

  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: PublishedMessage['options'],
  ): boolean {
    if (this.closed) {
      throw new Error('channel closed');
    }
    this.published.push({ exchange, routingKey, body: content, options });
    return this.publishReturnValue;
  }

  async waitForConfirms(): Promise<void> {
    if (this.confirmBehavior === 'never') {
      await new Promise<never>(() => {
        // Intentionally pending: exercises confirmation timeouts.
      });
    }
    if (this.confirmBehavior === 'reject') {
      throw new Error('nack received');
    }
    if (this.confirmMode === 'manual') {
      await new Promise<void>((resolve) => {
        this.confirmResolvers.push(resolve);
      });
    }
  }

  confirmNext(): void {
    this.confirmResolvers.shift()?.();
  }

  on(event: string, listener: (arg?: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  off(event: string, listener: (arg?: unknown) => void): void {
    const list = this.listeners.get(event);
    if (list !== undefined) {
      const index = list.indexOf(listener);
      if (index >= 0) {
        list.splice(index, 1);
      }
    }
  }

  /** Observable listener fan-out for lifecycle assertions. */
  listenerCountFor(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  emitReturn(messageId: string): void {
    for (const listener of this.listeners.get('return') ?? []) {
      listener({ properties: { messageId } });
    }
  }

  emitClose(): void {
    this.closed = true;
    for (const listener of this.listeners.get('close') ?? []) {
      listener();
    }
  }

  emitDrain(): void {
    for (const listener of this.listeners.get('drain') ?? []) {
      listener();
    }
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.emitClose();
    }
  }

  asManaged(): ManagedChannel {
    return this as unknown as ManagedChannel;
  }
}

export class FakeAmqpConnection {
  public channels: FakeAmqpChannel[] = [];
  public closed = false;
  public failChannelCreation = false;
  private readonly listeners = new Map<string, Array<(arg?: unknown) => void>>();

  async createConfirmChannel(): Promise<FakeAmqpChannel> {
    if (this.failChannelCreation) {
      throw new Error('channel creation refused');
    }
    const channel = new FakeAmqpChannel();
    this.channels.push(channel);
    return channel;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  on(event: string, listener: (arg?: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  emitClose(): void {
    for (const listener of this.listeners.get('close') ?? []) {
      listener();
    }
  }

  emitError(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) {
      listener(new Error(message));
    }
  }

  emitBlocked(): void {
    for (const listener of this.listeners.get('blocked') ?? []) {
      listener();
    }
  }

  emitUnblocked(): void {
    for (const listener of this.listeners.get('unblocked') ?? []) {
      listener();
    }
  }

  asManaged(): ManagedConnection {
    return this as unknown as ManagedConnection;
  }
}

/** Sequenced connector: fails a set number of times, then serves connections. */
export function sequencedConnect(failuresBeforeSuccess: number): {
  connect: (url: string) => Promise<ManagedConnection>;
  calls: string[];
  created: FakeAmqpConnection[];
} {
  const calls: string[] = [];
  const created: FakeAmqpConnection[] = [];
  let failuresLeft = failuresBeforeSuccess;
  return {
    calls,
    created,
    connect: async (url: string) => {
      calls.push(url);
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('ECONNREFUSED connect');
      }
      const connection = new FakeAmqpConnection();
      created.push(connection);
      return connection.asManaged();
    },
  };
}
