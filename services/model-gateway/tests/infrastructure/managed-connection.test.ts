/**
 * Regression tests for the managed AMQP connection.
 *
 * Reconnect backoff, single-flight attempts, invalidation, blocked states,
 * and shutdown are proven with sequenced fake connectors. No broker is
 * ever contacted.
 */
import { describe, expect, it } from 'vitest';
import { ManagedAmqpConnection } from '../../src/infrastructure/usage/managed-amqp-connection.js';
import { sequencedConnect } from '../test-doubles/fake-amqp.js';

const YIELD_SLEEP = async (_ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, 1));
};
const SLEEPS: number[] = [];
const RECORD_SLEEP = async (ms: number) => {
  SLEEPS.push(ms);
  await new Promise((resolve) => setTimeout(resolve, 1));
};
const FIXED_RANDOM = () => 0.5;

function managerWith(
  connector: ReturnType<typeof sequencedConnect>,
  overrides?: { sleep?: (ms: number) => Promise<void> },
) {
  return new ManagedAmqpConnection({
    url: 'amqp://broker:5672',
    exchange: 'oicunt.usage',
    connect: connector.connect,
    sleep: overrides?.sleep ?? YIELD_SLEEP,
    random: FIXED_RANDOM,
  });
}

describe('ManagedAmqpConnection', () => {
  it('connects, asserts the durable topic exchange, and reports ready', async () => {
    const connector = sequencedConnect(0);
    const manager = managerWith(connector);
    manager.start();
    for (let i = 0; i < 50 && !manager.isReady(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(manager.isReady()).toBe(true);
    expect(connector.calls).toEqual(['amqp://broker:5672']);
    const channel = connector.created[0]?.channels[0];
    expect(channel?.assertExchangeCalls).toEqual([{ exchange: 'oicunt.usage', type: 'topic' }]);
    const stats = manager.getStats();
    expect(stats.connected).toBe(true);
    expect(stats.blocked).toBe(false);
    expect(stats.reconnectAttempts).toBe(1);
    await manager.close();
  });

  it('backs off with jitter across consecutive failures, then connects', async () => {
    SLEEPS.length = 0;
    const connector = sequencedConnect(2);
    const manager = managerWith(connector, { sleep: RECORD_SLEEP });
    manager.start();
    for (let i = 0; i < 100 && !manager.isReady(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(manager.isReady()).toBe(true);
    expect(connector.calls).toHaveLength(3);
    // deterministic jitter 0.5: floor(1000*0.75), floor(2000*0.75)
    // (later entries are the healthy-idle sleeps, not reconnect backoff)
    expect(SLEEPS.slice(0, 2)).toEqual([750, 1500]);
    await manager.close();
  });

  it('runs a single reconnect attempt for concurrent invalidations', async () => {
    const connector = sequencedConnect(0);
    const manager = managerWith(connector);
    manager.start();
    for (let i = 0; i < 50 && !manager.isReady(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const connection = connector.created[0]!;
    // Fire three invalidations back-to-back: only one reconnect may start.
    connection.emitClose();
    connection.emitError('boom');
    connector.created[0]?.channels[0]?.emitClose();
    for (let i = 0; i < 50 && connector.calls.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(connector.calls.length).toBe(2);
    expect(manager.isReady()).toBe(true);
    await manager.close();
  });

  it('invalidates on channel close and reasserts the exchange after reconnect', async () => {
    const connector = sequencedConnect(0);
    const manager = managerWith(connector);
    manager.start();
    for (let i = 0; i < 50 && !manager.isReady(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    connector.created[0]?.channels[0]?.emitClose();
    expect(manager.isReady()).toBe(false);
    for (let i = 0; i < 50 && !manager.isReady(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(connector.calls).toHaveLength(2);
    expect(connector.created[1]?.channels[0]?.assertExchangeCalls).toEqual([
      { exchange: 'oicunt.usage', type: 'topic' },
    ]);
    await manager.close();
  });

  it('tracks blocked flow-control without dropping readiness of the channel', async () => {
    const connector = sequencedConnect(0);
    const manager = managerWith(connector);
    manager.start();
    for (let i = 0; i < 50 && !manager.isReady(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const connection = connector.created[0]!;
    connection.emitBlocked();
    expect(manager.isBlocked()).toBe(true);
    expect(manager.isReady()).toBe(false);
    expect(manager.getStats().blocked).toBe(true);
    connection.emitUnblocked();
    expect(manager.isBlocked()).toBe(false);
    expect(manager.isReady()).toBe(true);
    await manager.close();
  });

  it('closes idempotently and never reconnects afterwards', async () => {
    const connector = sequencedConnect(0);
    const manager = managerWith(connector);
    manager.start();
    for (let i = 0; i < 50 && !manager.isReady(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await manager.close();
    await manager.close();
    expect(manager.isReady()).toBe(false);
    connector.created[0]?.emitClose();
    connector.created[0]?.emitError('late');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connector.calls).toHaveLength(1);
    expect(connector.created[0]?.closed).toBe(true);
  });

  it('start() is idempotent and never blocks on a dead broker', async () => {
    const connector = sequencedConnect(1000);
    const manager = managerWith(connector);
    const started = Date.now();
    manager.start();
    manager.start();
    // Returns immediately even though every attempt fails.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(manager.isReady()).toBe(false);
    await manager.close();
  });
});
