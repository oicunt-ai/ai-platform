import { describe, expect, it, vi } from 'vitest';
import type { AgentRunId } from '../../src/domain/types.js';
import type {
  AmqpChannelLike,
  AmqpConnectionLike,
} from '../../src/infrastructure/queue/rabbitmq-agent-queue.js';
import { RabbitMqAgentQueue } from '../../src/infrastructure/queue/rabbitmq-agent-queue.js';

describe('RabbitMqAgentQueue Unit Tests', () => {
  const createMockChannel = (): AmqpChannelLike & {
    consumedHandler?: ((msg: any) => Promise<void>) | undefined;
  } => {
    let handler: ((msg: any) => Promise<void>) | undefined;
    return {
      assertExchange: vi.fn().mockResolvedValue({ exchange: 'oicunt.agents' }),
      assertQueue: vi.fn().mockResolvedValue({ queue: 'oicunt.agents.runs' }),
      bindQueue: vi.fn().mockResolvedValue({}),
      publish: vi.fn().mockReturnValue(true),
      prefetch: vi.fn().mockResolvedValue({}),
      consume: vi.fn().mockImplementation((_q, cb) => {
        handler = cb;
        return Promise.resolve({ consumerTag: 'tag-1' });
      }),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      get consumedHandler() {
        return handler;
      },
    };
  };

  const createMockConnection = (channel: AmqpChannelLike): AmqpConnectionLike => ({
    createChannel: vi.fn().mockResolvedValue(channel),
    close: vi.fn().mockResolvedValue(undefined),
  });

  it('publishes job to oicunt.agents exchange with routingKey and persistent flag', async () => {
    const mockChannel = createMockChannel();
    const mockConn = createMockConnection(mockChannel);

    const queue = new RabbitMqAgentQueue(
      {
        exchange: 'oicunt.agents',
        routingKey: 'agent.run.dispatch',
        queueName: 'oicunt.agents.runs',
      },
      mockConn,
    );

    const job = {
      jobId: 'job_123',
      runId: 'run_abc' as AgentRunId,
      tenantId: 'ten_01',
      actorId: 'usr_01',
      correlationId: 'corr_01',
      input: 'Perform analysis',
      timestamp: new Date().toISOString(),
    };

    await queue.publishRunJob(job);

    expect(mockChannel.assertExchange).toHaveBeenCalledWith('oicunt.agents', 'topic', {
      durable: true,
    });
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('oicunt.agents.runs', { durable: true });
    expect(mockChannel.bindQueue).toHaveBeenCalledWith(
      'oicunt.agents.runs',
      'oicunt.agents',
      'agent.run.dispatch',
    );
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'oicunt.agents',
      'agent.run.dispatch',
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        contentType: 'application/json',
        correlationId: 'corr_01',
        messageId: 'job_123',
      }),
    );
  });

  it('acknowledges message when worker handler completes successfully', async () => {
    const mockChannel = createMockChannel();
    const mockConn = createMockConnection(mockChannel);

    const queue = new RabbitMqAgentQueue({}, mockConn);
    const workerHandler = vi.fn().mockResolvedValue(undefined);

    queue.registerWorker(workerHandler);

    // Allow async registerWorker microtask to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockChannel.prefetch).toHaveBeenCalledWith(1);
    expect(mockChannel.consume).toHaveBeenCalledWith('oicunt.agents.runs', expect.any(Function), {
      noAck: false,
    });

    const testMsg = {
      content: Buffer.from(
        JSON.stringify({
          jobId: 'job_999',
          runId: 'run_xyz',
          tenantId: 'ten_01',
          actorId: 'usr_01',
          correlationId: 'corr_01',
          timestamp: new Date().toISOString(),
        }),
      ),
    };

    await mockChannel.consumedHandler!(testMsg);

    expect(workerHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job_999',
        runId: 'run_xyz',
      }),
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(testMsg);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('negatively acknowledges message (nack) when worker handler throws', async () => {
    const mockChannel = createMockChannel();
    const mockConn = createMockConnection(mockChannel);

    const queue = new RabbitMqAgentQueue({}, mockConn);
    const workerHandler = vi.fn().mockRejectedValue(new Error('Handler fatal crash'));

    queue.registerWorker(workerHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const testMsg = {
      content: Buffer.from(
        JSON.stringify({
          jobId: 'job_bad',
          runId: 'run_bad',
          tenantId: 'ten_01',
          actorId: 'usr_01',
          correlationId: 'corr_01',
          timestamp: new Date().toISOString(),
        }),
      ),
    };

    await mockChannel.consumedHandler!(testMsg);

    expect(workerHandler).toHaveBeenCalled();
    expect(mockChannel.ack).not.toHaveBeenCalled();
    expect(mockChannel.nack).toHaveBeenCalledWith(testMsg, false, false);
  });

  it('reports health correctly based on connection state', async () => {
    const mockChannel = createMockChannel();
    const mockConn = createMockConnection(mockChannel);

    const queue = new RabbitMqAgentQueue({}, mockConn);
    const healthy = await queue.checkHealth();
    expect(healthy).toBe(true);

    const failingConn: AmqpConnectionLike = {
      createChannel: vi.fn().mockRejectedValue(new Error('Connection broken')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const brokenQueue = new RabbitMqAgentQueue({}, failingConn);
    const failingHealthy = await brokenQueue.checkHealth();
    expect(failingHealthy).toBe(false);
  });

  it('closes channel and connection cleanly', async () => {
    const mockChannel = createMockChannel();
    const mockConn = createMockConnection(mockChannel);

    const queue = new RabbitMqAgentQueue({}, mockConn);
    await queue.publishRunJob({
      jobId: 'job_1',
      runId: 'run_1' as AgentRunId,
      tenantId: 'ten',
      actorId: 'act',
      correlationId: 'corr',
      timestamp: new Date().toISOString(),
    });

    await queue.close();
    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConn.close).toHaveBeenCalled();
  });
});
