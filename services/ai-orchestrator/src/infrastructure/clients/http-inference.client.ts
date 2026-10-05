import type { StreamEvent, StreamEventType } from '@oicunt-ai/ai-types';
import type {
  InferenceExecutionRequest,
  InferenceExecutionResponse,
} from '../../application/dtos/inference.dto.js';
import type { InferencePort } from '../../application/ports/inference.port.js';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  InferenceTimeoutError,
  InvalidRequestError,
  ModelInMaintenanceError,
  OrchestratorError,
  type OrchestratorErrorCode,
  RateLimitExceededError,
  RequestCancelledError,
  UnsupportedEffortLevelError,
} from '../../domain/errors.js';

export interface HttpInferenceClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
}

export class HttpInferenceClient implements InferencePort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;

  constructor(options: HttpInferenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
  }

  public async executeUnary(
    request: InferenceExecutionRequest,
    signal?: AbortSignal,
  ): Promise<InferenceExecutionResponse> {
    const url = `${this.baseUrl}/internal/v1/inference/execute`;
    const headers = this.buildHeaders(request, 'application/json');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request, stream: false }),
        ...(signal ? { signal } : {}),
      });

      if (response.ok) {
        const body = (await response.json()) as InferenceExecutionResponse;
        return body;
      }

      await this.handleErrorResponse(response, request);
      throw new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'Unexpected execution error from Inference Service',
        500,
        false,
        undefined,
        request.canonicalModelId,
        request.correlationId,
      );
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          request.correlationId,
        );
      }
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw this.mapUnknownError(err, request);
    }
  }

  public async *executeStream(
    request: InferenceExecutionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const url = `${this.baseUrl}/internal/v1/inference/execute`;
    const headers = this.buildHeaders(request, 'text/event-stream, application/json');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request, stream: true }),
        ...(signal ? { signal } : {}),
      });
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          request.correlationId,
        );
      }
      throw this.mapUnknownError(err, request);
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, request);
      return;
    }

    if (!response.body) {
      throw new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'Inference Service response stream was empty',
        502,
        false,
        undefined,
        request.canonicalModelId,
        request.correlationId,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let currentEvent = 'token';
    let currentData = '';

    try {
      while (true) {
        if (signal?.aborted) {
          throw new RequestCancelledError(
            'Inference request was cancelled by the caller.',
            request.correlationId,
          );
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') {
            if (currentData !== '') {
              try {
                const parsedData = JSON.parse(currentData);
                yield {
                  event: currentEvent as StreamEventType,
                  data: parsedData,
                } as StreamEvent;
              } catch {
                // Ignore parse errors for malformed intermediate data chunks
              }
              currentData = '';
              currentEvent = 'token';
            }
            continue;
          }

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const dataSlice = trimmed.slice(5).trim();
            currentData = currentData ? `${currentData}\n${dataSlice}` : dataSlice;
          }
        }
      }

      if (currentData !== '') {
        try {
          const parsedData = JSON.parse(currentData);
          yield {
            event: currentEvent as StreamEventType,
            data: parsedData,
          } as StreamEvent;
        } catch {
          // Ignore parse errors on trailing flush
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  public async checkHealth(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health/readiness`, {
        method: 'GET',
        ...(signal ? { signal } : {}),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildHeaders(request: InferenceExecutionRequest, accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: accept,
      'X-Service-Name': 'ai-orchestrator',
      'X-Correlation-ID': request.correlationId,
      'X-Request-ID': request.requestId,
      'X-Actor-ID': request.actorId,
    };

    if (request.tenantId) {
      headers['X-Tenant-ID'] = request.tenantId;
    }
    if (request.userId) {
      headers['X-User-ID'] = request.userId;
    }
    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }

    return headers;
  }

  private async handleErrorResponse(
    response: Response,
    request: InferenceExecutionRequest,
  ): Promise<never> {
    let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // Body not JSON
    }

    const code = errorBody.error?.code ?? '';
    const message =
      errorBody.error?.message ?? `Inference Service returned HTTP ${response.status}`;

    if (code === 'MODEL_IN_MAINTENANCE') {
      throw new ModelInMaintenanceError(request.canonicalModelId, request.correlationId);
    }
    if (code === 'ALL_TARGETS_EXHAUSTED' || code === 'NO_HEALTHY_TARGETS') {
      throw new AllTargetsExhaustedError(message, request.correlationId);
    }
    if (code === 'RATE_LIMIT_EXCEEDED' || response.status === 429) {
      throw new RateLimitExceededError(message, request.correlationId);
    }
    if (code === 'INFERENCE_TIMEOUT' || response.status === 504) {
      throw new InferenceTimeoutError(message, request.correlationId);
    }
    if (code === 'CONTEXT_WINDOW_EXCEEDED') {
      throw new ContextWindowExceededError(request.canonicalModelId, 0, 0, request.correlationId);
    }
    if (code === 'REQUEST_CANCELLED' || response.status === 499) {
      throw new RequestCancelledError(
        'Inference request was cancelled by caller',
        request.correlationId,
      );
    }
    if (code === 'UNSUPPORTED_EFFORT_LEVEL') {
      throw new UnsupportedEffortLevelError(
        request.canonicalModelId,
        request.effort ?? 'unknown',
        [],
        request.correlationId,
      );
    }
    if (response.status === 400 || code === 'INVALID_REQUEST') {
      throw new InvalidRequestError(message, request.correlationId);
    }

    throw new OrchestratorError(
      (code as OrchestratorErrorCode) || 'INTERNAL_ORCHESTRATOR_ERROR',
      message,
      response.status >= 500 ? 503 : response.status,
      response.status >= 500,
      undefined,
      request.canonicalModelId,
      request.correlationId,
    );
  }

  private mapUnknownError(err: unknown, request: InferenceExecutionRequest): OrchestratorError {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('cancel')) {
        return new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          request.correlationId,
        );
      }
      if (msg.includes('timeout')) {
        return new InferenceTimeoutError(err.message, request.correlationId);
      }
      return new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        err.message,
        503,
        true,
        undefined,
        request.canonicalModelId,
        request.correlationId,
      );
    }
    return new OrchestratorError(
      'INTERNAL_ORCHESTRATOR_ERROR',
      'Unknown Inference Service error',
      503,
      true,
      undefined,
      request.canonicalModelId,
      request.correlationId,
    );
  }
}
