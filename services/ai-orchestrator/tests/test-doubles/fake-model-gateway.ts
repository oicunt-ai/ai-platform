import type { NormalizedCompletionData, StreamEvent } from '@oicunt-ai/ai-types';
import type { GatewayDispatchPayload } from '../../src/application/dtos/dispatch.dto.js';
import type { ModelGatewayPort } from '../../src/application/ports/model-gateway.port.js';
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
      completionId: 'compl_test_12345',
      model: payload.canonicalModelId,
      message: {
        role: 'assistant',
        content: payload.effort
          ? [
              { type: 'thinking', thinking: 'Analyzing the request...' },
              { type: 'text', text: 'Hello! I completed your request.' },
            ]
          : 'Hello! I completed your request.',
      },
      finishReason: 'stop',
      usage: {
        promptTokens: 25,
        completionTokens: 10,
        totalTokens: 35,
        reasoningTokens: payload.effort ? 5 : undefined,
      },
      latencyMs: 120,
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

    // Default stream events
    if (payload.effort) {
      yield {
        event: 'thinking',
        data: { delta: 'Deep thought step 1.' },
      };
    }

    yield {
      event: 'token',
      data: { delta: 'Hello' },
    };

    yield {
      event: 'token',
      data: { delta: ' world!' },
    };

    yield {
      event: 'finish',
      data: {
        finishReason: 'stop',
        usage: {
          promptTokens: 25,
          completionTokens: 8,
          totalTokens: 33,
        },
      },
    };
  }

  public async checkHealth(_signal?: AbortSignal): Promise<boolean> {
    return this.isHealthy;
  }
}
