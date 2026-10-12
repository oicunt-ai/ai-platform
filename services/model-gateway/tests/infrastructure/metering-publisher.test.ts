/**
 * Regression tests for the hardened RabbitMQ metering publisher.
 *
 * Confirms, mandatory returns (correlated by messageId under concurrency),
 * uncertain-delivery handling, reconnect behavior, flow control, and
 * shutdown — all against in-memory AMQP doubles. No broker is contacted.
 */
import { describe, expect, it } from 'vitest';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import { ManagedAmqpConnection } from '../../src/infrastructure/usage/managed-amqp-connection.js';
import { RabbitMqUsagePublisher } from '../../src/infrastructure/usage/rabbitmq-usage.publisher.js';
import {
  UsagePublishError,
  UsageUnroutableError,
} from '../../src/infrastructure/usage/publish-errors.js';
import { FakeAmqpChannel, sequencedConnect } from '../test-doubles/fake-amqp.js';

const YIELD_SLEEP = async (_ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, 1));
};

function testEvent(key: string): UsageEvent {
  return {
    eventId: `usage_test-${key}`,
    schemaVersion: '1.0.0',
    tenantId: 'tnt_test',
    productId: 'billy',
    sourceService: 'model-gateway',
    operation: 'model.completion',
    resourceId: 'oicunt.model.test',
    measurements: { 'tokens.input': 1, 'tokens.output': 2, 'tokens.total': 3, 'units.requests': 1 },
    dimensions: { provider: 'test-provider' },
    lineage: { correlationId: `corr-${key}`, requestId: `req-${key}` },
    idempotencyKey: `model.completion:test-${key}`,
    occurredAt: new Date().toISOString(),
  };
}

function publisherWith(
  connector: ReturnType<typeof sequencedConnect>,
  options?: { confirmTimeoutMs?: number; drainTimeoutMs?: number },
) {
  const connection = new ManagedAmqpConnection({
    url: 'amqp://broker:5672',
    exchange: 'oicunt.usage',
    connect: connector.connect,
    sleep: YIELD_SLEEP,
    random: () => 0.5,
  });
  const publisher = new RabbitMqUsagePublisher({
    url: 'amqp://broker:5672',
    exchange: 'oicunt.usage',
    options: {
      confirmTimeoutMs: options?.confirmTimeoutMs ?? 5000,
      drainTimeoutMs: options?.drainTimeoutMs,
    },
    connection,
  });
  return { publisher, connection };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition(), label).toBe(true);
}

describe('RabbitMqUsagePublisher', () => {
  it('publishes confirmed events with mandatory, persistent routing', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');

    await publisher.send(testEvent('a'));

    const channel = connector.created[0]?.channels[0];
    expect(channel?.published).toHaveLength(1);
    const message = channel?.published[0];
    expect(message?.exchange).toBe('oicunt.usage');
    expect(message?.routingKey).toBe('usage.v1.model.completion');
    expect(message?.options?.mandatory).toBe(true);
    expect(message?.options?.persistent).toBe(true);
    expect(message?.options?.contentType).toBe('application/json');
    expect(message?.options?.messageId).toBe('usage_test-a');
    expect(JSON.parse(message?.body.toString() ?? '{}').eventId).toBe('usage_test-a');
    await publisher.close();
  });

  it('rejects unroutable events as permanent without marking them delivered', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmBehavior = 'never';

    const sending = publisher.send(testEvent('a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    channel!.emitReturn('usage_test-a');

    await expect(sending).rejects.toBeInstanceOf(UsageUnroutableError);
    await expect(sending).rejects.toMatchObject({ retryable: false });
    await publisher.close();
  });

  it('ignores returns for other messageIds and still confirms', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];

    const sending = publisher.send(testEvent('a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Stale return for a previous attempt of the same logical event stream:
    // wrong id means no correlation.
    channel!.emitReturn('usage_test-zzz');
    await expect(sending).resolves.toBeUndefined();
    await publisher.close();
  });

  it('correlates concurrent publications to the correct events', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmMode = 'manual';

    const first = publisher.send(testEvent('a'));
    const second = publisher.send(testEvent('b'));
    // Serialized sends: the first publishes immediately; the second waits
    // on the mutex. Settle them out of order to prove correlation.
    for (let i = 0; i < 50 && channel?.published.length !== 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(channel?.published.map((m) => m.options?.messageId)).toEqual(['usage_test-a']);
    channel!.emitReturn('usage_test-a');
    // Drain the first send's parked (now orphaned) manual confirm so FIFO
    // alignment holds for the live send below.
    channel!.confirmNext();
    await expect(first).rejects.toBeInstanceOf(UsageUnroutableError);
    // The second send proceeds on the same channel and confirms normally.
    for (let i = 0; i < 50 && channel?.published.length !== 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    channel!.confirmNext();
    await expect(second).resolves.toBeUndefined();
    expect(channel?.published.map((m) => m.options?.messageId)).toEqual([
      'usage_test-a',
      'usage_test-b',
    ]);
    await publisher.close();
  });

  it('treats connection loss before confirmation as retryable with stable identity', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmBehavior = 'never';

    const sending = publisher.send(testEvent('a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    channel!.emitClose();

    const failure = await sending.then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(UsagePublishError);
    expect((failure as UsagePublishError).retryable).toBe(true);
    expect((failure as UsagePublishError).eventId).toBe('usage_test-a');
    await publisher.close();
  });

  it('treats confirmation timeouts as retryable, never as confirmed loss', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector, { confirmTimeoutMs: 30 });
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    connector.created[0]!.channels[0]!.confirmBehavior = 'never';

    await expect(publisher.send(testEvent('a'))).rejects.toMatchObject({
      name: 'UsagePublishError',
      retryable: true,
    });
    await publisher.close();
  });

  it('fast-fails while disconnected and recovers after reconnect', async () => {
    const connector = sequencedConnect(1000);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    expect(publisher.isReady()).toBe(false);
    await expect(publisher.send(testEvent('a'))).rejects.toMatchObject({
      name: 'UsagePublishError',
    });
    await publisher.close();
  });

  it('rejects sends while the broker applies flow control', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    connector.created[0]?.emitBlocked();
    expect(publisher.isBlocked()).toBe(true);
    await expect(publisher.send(testEvent('a'))).rejects.toMatchObject({
      name: 'UsagePublishError',
    });
    connector.created[0]?.emitUnblocked();
    await publisher.send(testEvent('a'));
    expect(connector.created[0]?.channels[0]?.published).toHaveLength(1);
    await publisher.close();
  });

  it('reasserts the exchange after reconnect and keeps publishing', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    connector.created[0]?.channels[0]?.emitClose();
    await waitFor(() => connector.created.length >= 2, 'reconnected');
    await waitFor(() => publisher.isReady(), 'publisher ready again');
    expect(connector.created[1]?.channels[0]?.assertExchangeCalls).toEqual([
      { exchange: 'oicunt.usage', type: 'topic' },
    ]);
    await publisher.send(testEvent('a'));
    expect(connector.created[1]?.channels[0]?.published).toHaveLength(1);
    await publisher.close();
  });

  it('closes idempotently and rejects in-flight and later sends as retryable', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmBehavior = 'never';

    const sending = publisher.send(testEvent('a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await publisher.close();
    await publisher.close();
    await expect(sending).rejects.toMatchObject({ name: 'UsagePublishError', retryable: true });
    await expect(publisher.send(testEvent('b'))).rejects.toMatchObject({
      name: 'UsagePublishError',
    });
    expect(channel?.closed).toBe(true);
  });

  it('waits for drain when the write buffer is full', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.publishReturnValue = false;

    const sending = publisher.send(testEvent('a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(channel?.published).toHaveLength(1);
    channel!.emitDrain();
    await expect(sending).resolves.toBeUndefined();
    await publisher.close();
  });

  it('passes the configured broker URL through without hardcoded credentials', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    expect(connector.calls).toEqual(['amqp://broker:5672']);
    await publisher.close();
  });

  it('start() never blocks on a dead broker', async () => {
    const connector = sequencedConnect(1000);
    const { publisher } = publisherWith(connector);
    const started = Date.now();
    await publisher.start();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(publisher.isReady()).toBe(false);
    await publisher.close();
  });
});

describe('RabbitMqUsagePublisher reliability hardening', () => {
  it('1. selects a fresh channel for sends queued across a reconnect', async () => {
    const connector = sequencedConnect(0);
    const { publisher, connection } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const liveChannel = connector.created[0]?.channels[0];
    const freshChannel = new FakeAmqpChannel();
    // First selection sees the live channel; the queued send must use the
    // channel selected when it actually begins, not the stale one.
    let selections = 0;
    connection.getChannel = () => {
      selections += 1;
      return (selections === 1 ? liveChannel! : freshChannel).asManaged();
    };

    await publisher.send(testEvent('fresh'));

    expect(liveChannel?.published).toHaveLength(0);
    expect(freshChannel.published.map((m) => m.options?.messageId)).toEqual(['usage_test-fresh']);
    await publisher.close();
  });

  it('2. removes per-send listeners after each settled send', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    // The managed connection owns one long-lived 'close' listener; per-send
    // listeners must come and go around that baseline.
    const closeBaseline = channel?.listenerCountFor('close') ?? 0;

    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      await publisher.send(testEvent(key));
      expect(channel?.listenerCountFor('return')).toBe(0);
      expect(channel?.listenerCountFor('close')).toBe(closeBaseline);
    }
    expect(channel?.published).toHaveLength(5);
    await publisher.close();
  });

  it('3. resolves repeated publications of the same eventId independently', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    const closeBaseline = channel?.listenerCountFor('close') ?? 0;

    await publisher.send(testEvent('same'));
    await publisher.send(testEvent('same'));
    await expect(
      Promise.all([publisher.send(testEvent('same')), publisher.send(testEvent('same'))]),
    ).resolves.toEqual([undefined, undefined]);

    expect(channel?.published).toHaveLength(4);
    expect(channel?.listenerCountFor('return')).toBe(0);
    expect(channel?.listenerCountFor('close')).toBe(closeBaseline);
    await publisher.close();
  });

  it('4. rejects on mandatory return before confirmation without waiting', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector, { confirmTimeoutMs: 5000 });
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmMode = 'manual';
    const closeBaseline = channel?.listenerCountFor('close') ?? 0;

    const sending = publisher.send(testEvent('a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    channel!.emitReturn('usage_test-a');

    await expect(sending).rejects.toBeInstanceOf(UsageUnroutableError);
    // A parked manual confirm arriving afterwards must not settle anything.
    channel!.confirmNext();
    expect(channel?.listenerCountFor('return')).toBe(0);
    expect(channel?.listenerCountFor('close')).toBe(closeBaseline);
    await publisher.close();
  });

  it('5. cleans up listeners after a confirmation timeout', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector, { confirmTimeoutMs: 30 });
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmBehavior = 'never';
    const closeBaseline = channel?.listenerCountFor('close') ?? 0;

    await expect(publisher.send(testEvent('a'))).rejects.toMatchObject({
      name: 'UsagePublishError',
      retryable: true,
    });
    expect(channel?.listenerCountFor('return')).toBe(0);
    expect(channel?.listenerCountFor('close')).toBe(closeBaseline);
    // The publisher remains usable for later sends.
    channel!.confirmBehavior = 'confirm';
    await publisher.send(testEvent('b'));
    expect(channel?.published).toHaveLength(2);
    await publisher.close();
  });

  it('6. cleans up listeners after channel closure mid-send and recovers', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmBehavior = 'never';
    const closeBaseline = channel?.listenerCountFor('close') ?? 0;

    const sending = publisher.send(testEvent('a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    channel!.emitClose();

    await expect(sending).rejects.toMatchObject({ name: 'UsagePublishError', retryable: true });
    expect(channel?.listenerCountFor('return')).toBe(0);
    expect(channel?.listenerCountFor('close')).toBe(closeBaseline);

    await waitFor(() => publisher.isReady(), 'publisher ready again');
    await publisher.send(testEvent('b'));
    expect(connector.created.length).toBeGreaterThanOrEqual(2);
    await publisher.close();
  });

  it('7. bounds write-buffer backpressure with a drain timeout', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector, { drainTimeoutMs: 30 });
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.publishReturnValue = false;
    const closeBaseline = channel?.listenerCountFor('close') ?? 0;

    await expect(publisher.send(testEvent('a'))).rejects.toMatchObject({
      name: 'UsagePublishError',
      retryable: true,
    });
    expect(channel?.listenerCountFor('drain')).toBe(0);
    expect(channel?.listenerCountFor('close')).toBe(closeBaseline);
    await publisher.close();
  });

  it('8. rejects queued sends on close without stranding promises', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    channel!.confirmMode = 'manual';

    const first = publisher.send(testEvent('a'));
    const second = publisher.send(testEvent('b'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await publisher.close();

    await expect(first).rejects.toMatchObject({ name: 'UsagePublishError', retryable: true });
    await expect(second).rejects.toMatchObject({ name: 'UsagePublishError', retryable: true });
  });

  it('9. fast-fails sends queued during an outage and succeeds after reconnect', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    connector.created[0]?.channels[0]?.emitClose();

    // Invalidation is synchronous: the pre-check fast-fails without queueing.
    await expect(publisher.send(testEvent('outage'))).rejects.toMatchObject({
      name: 'UsagePublishError',
      retryable: true,
    });
    await waitFor(() => publisher.isReady(), 'publisher ready again');
    await publisher.send(testEvent('recovered'));
    expect(connector.created.length).toBeGreaterThanOrEqual(2);
    const latest = connector.created[connector.created.length - 1]?.channels[0];
    expect(latest?.published.map((m) => m.options?.messageId)).toEqual(['usage_test-recovered']);
    await publisher.close();
  });

  it('10. ignores late broker events after settlement', async () => {
    const connector = sequencedConnect(0);
    const { publisher } = publisherWith(connector);
    await publisher.start();
    await waitFor(() => publisher.isReady(), 'publisher becomes ready');
    const channel = connector.created[0]?.channels[0];
    const closeBaseline = channel?.listenerCountFor('close') ?? 0;

    await publisher.send(testEvent('a'));
    // Late return and close for an already-settled send must be ignored.
    channel!.emitReturn('usage_test-a');
    await publisher.send(testEvent('b'));
    expect(channel?.published.map((m) => m.options?.messageId)).toEqual([
      'usage_test-a',
      'usage_test-b',
    ]);
    expect(channel?.listenerCountFor('return')).toBe(0);
    expect(channel?.listenerCountFor('close')).toBe(closeBaseline);
    await publisher.close();
  });
});
