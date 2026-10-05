import type { NormalizedCompletionData, StreamEvent } from '@oicunt-ai/ai-types';
import type { ResolvedTargetDto } from '../../src/application/dtos/dispatch.dto.js';
import type {
  IProviderAdapter,
  ProviderExecutionRequest,
} from '../../src/application/ports/provider-adapter.port.js';

export interface FakeProviderBehavior {
  readonly unaryHandler?: (req: ProviderExecutionRequest) => Promise<NormalizedCompletionData>;
  readonly streamEvents?: readonly StreamEvent[];
  readonly streamDelayMs?: number;
  readonly unaryDelayMs?: number;
  readonly healthy?: boolean;
}

export class FakeProviderAdapter implements IProviderAdapter {
  public readonly provider: string;
  public readonly unaryCalls: ProviderExecutionRequest[] = [];
  public readonly streamCalls: ProviderExecutionRequest[] = [];

  private unaryQueue: Array<(req: ProviderExecutionRequest) => Promise<NormalizedCompletionData>> =
    [];
  private defaultUnaryHandler: (req: ProviderExecutionRequest) => Promise<NormalizedCompletionData>;
  private defaultStreamEvents: StreamEvent[] = [];
  private streamDelayMs = 0;
  private unaryDelayMs = 0;
  private isHealthy = true;

  constructor(provider = 'custom', initialBehavior?: FakeProviderBehavior) {
    this.provider = provider;
    this.defaultUnaryHandler =
      initialBehavior?.unaryHandler ??
      (async (req) => {
        return {
          completionId: req.completionId,
          model: req.payload.canonicalModelId,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from fake provider' }],
          },
          finishReason: 'stop',
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
          latencyMs: 15,
        };
      });

    if (initialBehavior?.streamEvents) {
      this.defaultStreamEvents = [...initialBehavior.streamEvents];
    } else {
      this.defaultStreamEvents = [
        { event: 'token', data: { delta: 'Hello' } },
        { event: 'token', data: { delta: ' world' } },
        {
          event: 'finish',
          data: {
            finishReason: 'stop',
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          },
        },
      ];
    }

    if (initialBehavior?.streamDelayMs !== undefined) {
      this.streamDelayMs = initialBehavior.streamDelayMs;
    }
    if (initialBehavior?.unaryDelayMs !== undefined) {
      this.unaryDelayMs = initialBehavior.unaryDelayMs;
    }
    if (initialBehavior?.healthy !== undefined) {
      this.isHealthy = initialBehavior.healthy;
    }
  }

  public enqueueUnaryResponse(
    handler: (req: ProviderExecutionRequest) => Promise<NormalizedCompletionData>,
  ): void {
    this.unaryQueue.push(handler);
  }

  public setStreamEvents(events: StreamEvent[]): void {
    this.defaultStreamEvents = [...events];
  }

  public setStreamDelayMs(delayMs: number): void {
    this.streamDelayMs = delayMs;
  }

  public setUnaryDelayMs(delayMs: number): void {
    this.unaryDelayMs = delayMs;
  }

  public setHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }

  public async executeUnary(request: ProviderExecutionRequest): Promise<NormalizedCompletionData> {
    this.unaryCalls.push(request);

    if (this.unaryDelayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.unaryDelayMs);
        if (request.cancellationSignal.aborted) {
          clearTimeout(timer);
          reject(request.cancellationSignal.reason ?? new Error('Aborted'));
          return;
        }
        request.cancellationSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(request.cancellationSignal.reason ?? new Error('Aborted'));
        });
      });
    }

    if (request.cancellationSignal.aborted) {
      throw request.cancellationSignal.reason ?? new Error('Aborted');
    }

    const handler = this.unaryQueue.shift() ?? this.defaultUnaryHandler;
    return handler(request);
  }

  public async *executeStream(request: ProviderExecutionRequest): AsyncIterable<StreamEvent> {
    this.streamCalls.push(request);

    for (const event of this.defaultStreamEvents) {
      if (request.cancellationSignal.aborted) {
        throw request.cancellationSignal.reason ?? new Error('Aborted');
      }

      if (this.streamDelayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, this.streamDelayMs);
          if (request.cancellationSignal.aborted) {
            clearTimeout(timer);
            reject(request.cancellationSignal.reason ?? new Error('Aborted'));
            return;
          }
          request.cancellationSignal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(request.cancellationSignal.reason ?? new Error('Aborted'));
          });
        });
      }

      yield event;
    }
  }

  public async healthCheck(_target: ResolvedTargetDto): Promise<boolean> {
    return this.isHealthy;
  }
}
