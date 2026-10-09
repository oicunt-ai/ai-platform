import type { UsageEvent } from '@oicunt-ai/usage-types';

export interface UsagePublisherPort {
  start(): Promise<void>;
  publish(event: UsageEvent): Promise<void>;
  isReady(): boolean;
  close(): Promise<void>;
}
