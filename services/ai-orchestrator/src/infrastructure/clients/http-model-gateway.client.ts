import type { NormalizedCompletionData, StreamEvent, StreamEventType } from '@oicunt-ai/ai-types';
import type { GatewayDispatchPayload } from '../../application/dtos/dispatch.dto.js';
import type { ModelGatewayPort } from '../../application/ports/model-gateway.port.js';
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
} from '../../domain/errors.js';

export interface HttpModelGatewayClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
}

export class HttpModelGatewayClient implements ModelGatewayPort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;

  constructor(options: HttpModelGatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
  }

  public async dispatchUnary(
    payload: GatewayDispatchPayload,
    signal?: AbortSignal,
  ): Promise<NormalizedCompletionData> {
    const url = `${this.baseUrl}/internal/v1/models/dispatch`;
    const headers = this.buildHeaders(payload, 'application/json');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          success?: boolean;
          data?: NormalizedCompletionData;
        } & NormalizedCompletionData;

        return (body.data ?? body) as NormalizedCompletionData;
      }

      await this.handleErrorResponse(response, payload);
      throw new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'Unexpected execution error',
        500,
        false,
        undefined,
        payload.canonicalModelId,
        payload.correlationId,
      );
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          payload.correlationId,
        );
      }
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw this.mapUnknownError(err, payload);
    }
  }

  public async *dispatchStream(
    payload: GatewayDispatchPayload,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const url = `${this.baseUrl}/internal/v1/models/dispatch`;
    const headers = this.buildHeaders(payload, 'text/event-stream, application/json');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, stream: true }),
        ...(signal ? { signal } : {}),
      });
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          payload.correlationId,
        );
      }
      throw this.mapUnknownError(err, payload);
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, payload);
      return;
    }

    if (!response.body) {
      throw new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'Model Gateway response stream was empty',
        502,
        false,
        undefined,
        payload.canonicalModelId,
        payload.correlationId,
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
            payload.correlationId,
          );
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') {
            // End of an event
            if (currentData !== '') {
              try {
                const parsedData = JSON.parse(currentData);
                yield {
                  event: currentEvent as StreamEventType,
                  data: parsedData,
                } as StreamEvent;
              } catch {
                // If not valid JSON, treat as string or skip
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

      // Flush any trailing event
      if (currentData !== '') {
        try {
          const parsedData = JSON.parse(currentData);
          yield {
            event: currentEvent as StreamEventType,
            data: parsedData,
          } as StreamEvent;
        } catch {
          // Ignore parse error on flush
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

  private buildHeaders(payload: GatewayDispatchPayload, accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: accept,
      'X-Service-Name': 'ai-orchestrator',
      'X-Correlation-ID': payload.correlationId,
      'X-Request-ID': payload.requestId,
      'X-Actor-ID': payload.actorId,
    };

    if (payload.tenantId) {
      headers['X-Tenant-ID'] = payload.tenantId;
    }
    if (payload.userId) {
      headers['X-User-ID'] = payload.userId;
    }
    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }

    return headers;
  }

  private async handleErrorResponse(
    response: Response,
    payload: GatewayDispatchPayload,
  ): Promise<never> {
    let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // Body not JSON
    }

    const code = errorBody.error?.code ?? '';
    const message = errorBody.error?.message ?? `Model Gateway returned HTTP ${response.status}`;

    if (code === 'MODEL_IN_MAINTENANCE') {
      throw new ModelInMaintenanceError(payload.canonicalModelId, payload.correlationId);
    }
    if (code === 'ALL_TARGETS_EXHAUSTED' || code === 'NO_HEALTHY_TARGETS') {
      throw new AllTargetsExhaustedError(message, payload.correlationId);
    }
    if (code === 'RATE_LIMIT_EXCEEDED' || response.status === 429) {
      throw new RateLimitExceededError(message, payload.correlationId);
    }
    if (code === 'INFERENCE_TIMEOUT' || response.status === 504) {
      throw new InferenceTimeoutError(message, payload.correlationId);
    }
    if (code === 'CONTEXT_WINDOW_EXCEEDED') {
      throw new ContextWindowExceededError(payload.canonicalModelId, 0, 0, payload.correlationId);
    }
    if (code === 'REQUEST_CANCELLED') {
      throw new RequestCancelledError('Inference cancelled by caller', payload.correlationId);
    }
    if (response.status === 400) {
      throw new InvalidRequestError(message, payload.correlationId);
    }

    throw new OrchestratorError(
      (code as OrchestratorErrorCode) || 'INTERNAL_ORCHESTRATOR_ERROR',
      message,
      response.status >= 500 ? 503 : response.status,
      response.status >= 500,
      undefined,
      payload.canonicalModelId,
      payload.correlationId,
    );
  }

  private mapUnknownError(err: unknown, payload: GatewayDispatchPayload): OrchestratorError {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('cancel')) {
        return new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          payload.correlationId,
        );
      }
      if (msg.includes('timeout')) {
        return new InferenceTimeoutError(err.message, payload.correlationId);
      }
      return new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        err.message,
        503,
        true,
        undefined,
        payload.canonicalModelId,
        payload.correlationId,
      );
    }
    return new OrchestratorError(
      'INTERNAL_ORCHESTRATOR_ERROR',
      'Unknown Gateway error',
      503,
      true,
      undefined,
      payload.canonicalModelId,
      payload.correlationId,
    );
  }
}
