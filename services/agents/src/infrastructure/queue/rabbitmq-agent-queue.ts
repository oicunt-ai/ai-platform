import amqplib from 'amqplib';
import type { AgentQueuePort, AgentRunJob } from '../../application/ports/agent-queue.port.js';

export interface RabbitMqAgentQueueConfig {
  readonly url?: string | undefined;
  readonly exchange?: string | undefined;
  readonly routingKey?: string | undefined;
  readonly queueName?: string | undefined;
  readonly prefetch?: number | undefined;
}

export interface AmqpChannelLike {
  assertExchange(
    exchange: string,
    type: string,
    options?: amqplib.Options.AssertExchange,
  ): Promise<unknown>;
  assertQueue(queue: string, options?: amqplib.Options.AssertQueue): Promise<unknown>;
  bindQueue(queue: string, source: string, pattern: string, args?: unknown): Promise<unknown>;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: amqplib.Options.Publish,
  ): boolean;
  prefetch(count: number): Promise<unknown>;
  consume(
    queue: string,
    onMessage: (msg: amqplib.ConsumeMessage | null) => void,
    options?: amqplib.Options.Consume,
  ): Promise<amqplib.Replies.Consume>;
  ack(message: amqplib.Message, allUp?: boolean): void;
  nack(message: amqplib.Message, allUp?: boolean, requeue?: boolean): void;
  close(): Promise<void>;
}

export interface AmqpConnectionLike {
  createChannel(): Promise<AmqpChannelLike>;
  close(): Promise<void>;
}

export class RabbitMqAgentQueue implements AgentQueuePort {
  private readonly url: string;
  private readonly exchange: string;
  private readonly routingKey: string;
  private readonly queueName: string;
  private readonly prefetchCount: number;

  private connection: AmqpConnectionLike | null = null;
  private channel: AmqpChannelLike | null = null;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    config: RabbitMqAgentQueueConfig = {},
    customConnection?: AmqpConnectionLike | undefined,
  ) {
    this.url = config.url ?? process.env['RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672';
    this.exchange = config.exchange ?? 'oicunt.agents';
    this.routingKey = config.routingKey ?? 'agent.run.dispatch';
    this.queueName = config.queueName ?? 'oicunt.agents.runs';
    this.prefetchCount = config.prefetch ?? 1;

    if (customConnection) {
      this.connection = customConnection;
    }
  }

  private async ensureInitialized(): Promise<AmqpChannelLike> {
    if (this.channel) {
      return this.channel;
    }

    if (this.isInitializing && this.initPromise) {
      await this.initPromise;
      if (this.channel) {
        return this.channel;
      }
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        if (!this.connection) {
          this.connection = (await amqplib.connect(this.url)) as unknown as AmqpConnectionLike;
        }

        const channel = await this.connection.createChannel();
        await channel.assertExchange(this.exchange, 'topic', { durable: true });
        await channel.assertQueue(this.queueName, { durable: true });
        await channel.bindQueue(this.queueName, this.exchange, this.routingKey);

        this.channel = channel;
      } finally {
        this.isInitializing = false;
      }
    })();

    await this.initPromise;
    if (!this.channel) {
      throw new Error('Failed to initialize RabbitMQ channel');
    }
    return this.channel;
  }

  public async publishRunJob(job: AgentRunJob): Promise<void> {
    const channel = await this.ensureInitialized();
    const payload = Buffer.from(JSON.stringify(job), 'utf-8');

    const published = channel.publish(this.exchange, this.routingKey, payload, {
      persistent: true,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      messageId: job.jobId,
      correlationId: job.correlationId,
      timestamp: Date.now(),
    });

    if (!published) {
      throw new Error(`Failed to publish agent job '${job.jobId}' to exchange '${this.exchange}'`);
    }
  }

  public registerWorker(handler: (job: AgentRunJob) => Promise<void>): void {
    void (async () => {
      const channel = await this.ensureInitialized();
      await channel.prefetch(this.prefetchCount);

      await channel.consume(
        this.queueName,
        async (msg) => {
          if (!msg) {
            return;
          }

          try {
            const rawContent = msg.content.toString('utf-8');
            const job = JSON.parse(rawContent) as AgentRunJob;

            await handler(job);
            channel.ack(msg);
          } catch {
            // Discard unprocessable/poison messages or route to dead-letter exchange
            channel.nack(msg, false, false);
          }
        },
        { noAck: false },
      );
    })();
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const channel = await this.ensureInitialized();
      return channel !== null;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.channel) {
      try {
        await this.channel.close();
      } catch {
        // ignore
      }
      this.channel = null;
    }

    if (this.connection) {
      try {
        await this.connection.close();
      } catch {
        // ignore
      }
      this.connection = null;
    }
  }
}
