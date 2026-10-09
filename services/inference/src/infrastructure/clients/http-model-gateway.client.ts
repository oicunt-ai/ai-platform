import type { NormalizedCompletionData, StreamEvent, StreamEventType } from '@oicunt-ai/ai-types';
import type {
  GatewayDispatchPayload,
  ModelGatewayPort,
} from '../../application/ports/model-gateway.port.js';
import {
  AllTargetsExhaustedError,
  AuthenticationError,
  ContextWindowExceededError,
  ForbiddenError,
  InferenceError,
  InferenceTimeoutError,
  InternalInferenceError,
  InvalidRequestError,
  ModelUnavailableError,
  RequestCancelledError,
  UnsupportedEffortLevelError,
} from '../../domain/errors.js';
import { createInternalServiceToken } from '../security/internal-service-token.js';

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
      throw new InternalInferenceError(
        'Unexpected execution error from Model Gateway',
        payload.correlationId,
      );
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          payload.correlationId,
        );
      }
      if (err instanceof InferenceError) {
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
    }

    if (!response.body) {
      throw new InternalInferenceError(
        'Model Gateway returned empty response stream body',
        payload.correlationId,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          throw new RequestCancelledError(
            'Inference request was cancelled by the caller.',
            payload.correlationId,
          );
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent: StreamEventType = 'token';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.replace('event:', '').trim() as StreamEventType;
          } else if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.replace('data:', '').trim();
            try {
              const parsedData = JSON.parse(dataStr);
              yield {
                event: currentEvent,
                data: parsedData,
              } as StreamEvent;
            } catch {
              // Ignore invalid JSON chunks in SSE stream
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  public async checkHealth(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`, {
        method: 'GET',
        headers: this.internalToken ? { Authorization: `Bearer ${this.internalToken}` } : {},
        ...(signal ? { signal } : {}),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildHeaders(payload: GatewayDispatchPayload, accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: accept,
      'X-Request-ID': payload.requestId,
      'X-Correlation-ID': payload.correlationId,
      'X-Service-Name': 'inference',
      'X-Actor-ID': payload.actorId,
    };

    if (this.internalToken) {
      const token = createInternalServiceToken({
        issuer: 'inference',
        audience: 'model-gateway',
        secret: this.internalToken,
        expiresInSeconds: 300,
        tenantId: payload.tenantId,
        userId: payload.userId,
        requestId: payload.requestId,
        correlationId: payload.correlationId,
      });
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (payload.tenantId) {
      headers['X-Tenant-ID'] = payload.tenantId;
    }
    if (payload.userId) {
      headers['X-User-ID'] = payload.userId;
    }

    return headers;
  }

  private async handleErrorResponse(
    response: Response,
    payload: GatewayDispatchPayload,
  ): Promise<never> {
    let errorCode = 'INTERNAL_INFERENCE_ERROR';
    let errorMessage = `Model Gateway execution failed with status ${response.status}`;
    let details: unknown;

    try {
      const errBody = (await response.json()) as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (errBody?.error) {
        errorCode = errBody.error.code ?? errorCode;
        errorMessage = errBody.error.message ?? errorMessage;
        details = errBody.error.details;
      }
    } catch {
      // Use status text if JSON parsing fails
    }

    switch (response.status) {
      case 401:
        throw new AuthenticationError(errorMessage, payload.correlationId);
      case 403:
        throw new ForbiddenError(errorMessage, payload.correlationId);
      case 400:
        throw new InvalidRequestError(errorMessage, payload.correlationId, details);
      case 422:
        if (errorCode === 'CONTEXT_WINDOW_EXCEEDED') {
          throw new ContextWindowExceededError(
            errorMessage,
            payload.canonicalModelId,
            payload.correlationId,
            details,
          );
        }
        if (errorCode === 'UNSUPPORTED_EFFORT_LEVEL') {
          throw new UnsupportedEffortLevelError(
            payload.canonicalModelId,
            payload.effort ?? 'unknown',
            undefined,
            payload.correlationId,
          );
        }
        throw new InvalidRequestError(errorMessage, payload.correlationId, details);
      case 499:
        throw new RequestCancelledError(errorMessage, payload.correlationId);
      case 503:
        if (errorCode === 'ALL_TARGETS_EXHAUSTED') {
          throw new AllTargetsExhaustedError(errorMessage, payload.correlationId, details);
        }
        throw new ModelUnavailableError(
          payload.canonicalModelId,
          errorMessage,
          payload.correlationId,
          details,
        );
      case 504:
        throw new InferenceTimeoutError(
          payload.deadlineMs ? Math.max(0, payload.deadlineMs - Date.now()) : 60_000,
          payload.correlationId,
          details,
        );
      default:
        throw new InternalInferenceError(errorMessage, payload.correlationId, details);
    }
  }

  private mapUnknownError(err: unknown, payload: GatewayDispatchPayload): InferenceError {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('cancel')) {
        return new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          payload.correlationId,
        );
      }
      if (msg.includes('timeout') || msg.includes('deadline')) {
        return new InferenceTimeoutError(60_000, payload.correlationId);
      }
      if (msg.includes('econnrefused') || msg.includes('fetch failed')) {
        return new AllTargetsExhaustedError(
          `Unable to connect to Model Gateway at ${this.baseUrl}: ${err.message}`,
          payload.correlationId,
        );
      }
      return new InternalInferenceError(err.message, payload.correlationId);
    }
    return new InternalInferenceError(
      'An unexpected error occurred while communicating with Model Gateway',
      payload.correlationId,
    );
  }
}
