import type { NormalizedCompletionData, StreamEvent } from '@oicunt-ai/ai-types';
import type {
  GatewayDispatchPayload,
  ModelGatewayPort,
} from '../../src/application/ports/model-gateway.port.js';
import { RequestCancelledError } from '../../src/domain/errors.js';

export class FakeModelGateway implements ModelGatewayPort {
  public recordedDispatches: GatewayDispatchPayload[] = [];
  public customUnaryResponse?: NormalizedCompletionData;
  public customStreamEvents?: StreamEvent[];
  public shouldFailUnaryWith: Error | null = null;
  public shouldFailStreamWith: Error | null = null;
  public delayMs = 0;
  public isHealthy = true;

  public async dispatchUnary(
    payload: GatewayDispatchPayload,
    signal?: AbortSignal,
  ): Promise<NormalizedCompletionData> {
    this.recordedDispatches.push(payload);

    if (this.delayMs > 0) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, this.delayMs);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              reject(new RequestCancelledError('Request cancelled', payload.correlationId));
            },
            { once: true },
          );
        }
      });
    }

    if (signal?.aborted) {
      throw new RequestCancelledError('Request cancelled', payload.correlationId);
    }

    if (this.shouldFailUnaryWith) {
      throw this.shouldFailUnaryWith;
    }

    if (this.customUnaryResponse) {
      return this.customUnaryResponse;
    }

    return {
      completionId: 'cmpl_fake_123',
      model: payload.canonicalModelId,
      message: {
        role: 'assistant',
        content: payload.effort
          ? [
              { type: 'thinking', thinking: 'Analyzing the prompt carefully...' },
              { type: 'text', text: 'Here is the generated inference output.' },
            ]
          : 'Here is the generated inference output.',
      },
      finishReason: 'stop',
      usage: {
        promptTokens: 30,
        completionTokens: 15,
        totalTokens: 45,
        reasoningTokens: payload.effort ? 5 : undefined,
      },
      latencyMs: 85,
    };
  }

  public async *dispatchStream(
    payload: GatewayDispatchPayload,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    this.recordedDispatches.push(payload);

    if (signal?.aborted) {
      throw new RequestCancelledError('Request cancelled', payload.correlationId);
    }

    if (this.shouldFailStreamWith) {
      throw this.shouldFailStreamWith;
    }

    if (this.customStreamEvents) {
      for (const event of this.customStreamEvents) {
        if (signal?.aborted) {
          throw new RequestCancelledError('Request cancelled', payload.correlationId);
        }
        if (this.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
        yield event;
      }
      return;
    }

    if (payload.effort) {
      yield {
        event: 'thinking',
        data: { delta: 'Thinking trace chunk.' },
      };
    }

    yield {
      event: 'token',
      data: { delta: 'Inference' },
    };

    yield {
      event: 'token',
      data: { delta: ' output stream.' },
    };

    yield {
      event: 'finish',
      data: {
        finishReason: 'stop',
        usage: {
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
        },
      },
    };
  }

  public async checkHealth(_signal?: AbortSignal): Promise<boolean> {
    return this.isHealthy;
  }
}
