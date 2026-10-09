import amqplib from 'amqplib';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import type { UsagePublisherPort } from '../../application/ports/usage-publisher.port.js';

export class RabbitMqUsagePublisher implements UsagePublisherPort {
  private connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
  private channel: Awaited<
    ReturnType<Awaited<ReturnType<typeof amqplib.connect>>['createConfirmChannel']>
  > | null = null;

  constructor(
    private readonly url: string,
    private readonly exchange: string,
  ) {}

  async start(): Promise<void> {
    if (this.channel) return;
    this.connection = await amqplib.connect(this.url);
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
  }

  isReady(): boolean {
    return this.channel !== null;
  }

  async publish(event: UsageEvent): Promise<void> {
    if (!this.channel) throw new Error('Usage publisher is not ready');
    this.channel.publish(
      this.exchange,
      'usage.v1.model.completion',
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        correlationId: event.lineage.correlationId,
      },
    );
    await this.channel.waitForConfirms();
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = null;
    this.connection = null;
  }
}
