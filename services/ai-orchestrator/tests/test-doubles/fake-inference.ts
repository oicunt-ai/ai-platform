import type { StreamEvent } from '@oicunt-ai/ai-types';
import type {
  InferenceExecutionRequest,
  InferenceExecutionResponse,
  InferenceResultData,
} from '../../src/application/dtos/inference.dto.js';
import type { InferencePort } from '../../src/application/ports/inference.port.js';
import { RequestCancelledError } from '../../src/domain/errors.js';

export class FakeInference implements InferencePort {
  public recordedRequests: InferenceExecutionRequest[] = [];
  public customUnaryResponse?: InferenceExecutionResponse;
  public customStreamEvents?: StreamEvent[];
  public shouldFailUnaryWith: Error | null = null;
  public shouldFailStreamWith: Error | null = null;
  public delayMs = 0;
  public isHealthy = true;

  public async executeUnary(
    request: InferenceExecutionRequest,
    signal?: AbortSignal,
  ): Promise<InferenceExecutionResponse> {
    this.recordedRequests.push(request);

    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, this.delayMs);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              reject(new RequestCancelledError('Request cancelled', request.correlationId));
            },
            { once: true },
          );
        }
      });
    }

    if (signal?.aborted) {
      throw new RequestCancelledError('Request cancelled', request.correlationId);
    }

    if (this.shouldFailUnaryWith) {
      throw this.shouldFailUnaryWith;
    }

    if (this.customUnaryResponse) {
      return this.customUnaryResponse;
    }

    const data: InferenceResultData = {
      completionId: 'compl_test_12345',
      model: request.canonicalModelId,
      version: request.version,
      effort: request.effort,
      message: {
        role: 'assistant',
        content: request.effort
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
        reasoningTokens: request.effort ? 5 : undefined,
      },
      metadata: {
        requestId: request.requestId,
        correlationId: request.correlationId,
        provider: 'test-provider',
        targetExecuted: 'test-provider:region-a:prod',
        latencyMs: 120,
      },
    };

    return {
      success: true,
      data,
      meta: {
        requestId: request.requestId,
        correlationId: request.correlationId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  public async *executeStream(
    request: InferenceExecutionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    this.recordedRequests.push(request);

    if (signal?.aborted) {
      throw new RequestCancelledError('Request cancelled', request.correlationId);
    }

    if (this.shouldFailStreamWith) {
      throw this.shouldFailStreamWith;
    }

    if (this.customStreamEvents) {
      for (const event of this.customStreamEvents) {
        if (signal?.aborted) {
          throw new RequestCancelledError('Request cancelled', request.correlationId);
        }
        if (this.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
        yield event;
      }
      return;
    }

    // Default stream events
    if (request.effort) {
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
