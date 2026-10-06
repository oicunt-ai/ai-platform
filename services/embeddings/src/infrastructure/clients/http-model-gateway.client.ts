import type {
  EmbeddingDispatchPayload,
  EmbeddingDispatchResult,
  ModelGatewayPort,
} from '../../application/ports/model-gateway.port.js';
import {
  AuthenticationError,
  DeadlineExceededError,
  ForbiddenError,
  InvalidRequestError,
  ModelUnavailableError,
  ProviderExecutionFailedError,
  RateLimitedError,
  RequestCancelledError,
} from '../../domain/errors.js';

export interface HttpModelGatewayClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export class HttpModelGatewayClient implements ModelGatewayPort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: HttpModelGatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  public async dispatchEmbeddings(
    payload: EmbeddingDispatchPayload,
    signal?: AbortSignal,
  ): Promise<EmbeddingDispatchResult> {
    const url = `${this.baseUrl}/internal/v1/models/dispatch`;
    const headers = this.buildHeaders(payload);

    let effectiveTimeoutMs = this.timeoutMs;
    if (payload.deadlineMs !== undefined) {
      const remaining = payload.deadlineMs - Date.now();
      if (remaining <= 0) {
        throw new DeadlineExceededError(
          'Monotonic deadline exceeded prior to dispatching to Model Gateway',
        );
      }
      effectiveTimeoutMs = Math.min(effectiveTimeoutMs, remaining);
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error('Model Gateway embedding request timed out'));
    }, effectiveTimeoutMs);

    const onParentAbort = (): void => {
      abortController.abort(signal?.reason);
    };

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutHandle);
        throw new RequestCancelledError('Operation was cancelled prior to dispatching embedding');
      }
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (response.ok) {
        const body = (await response.json()) as {
          success?: boolean;
          data?: Record<string, unknown>;
          vectors?: readonly (readonly number[])[];
          embeddings?: readonly { index: number; vector: readonly number[] }[];
          usage?: { promptTokens?: number; totalTokens?: number };
          targetUsed?: string;
          providerUsed?: string;
        };

        const data = (body.data ?? body) as {
          vectors?: readonly (readonly number[])[];
          embeddings?: readonly { index: number; vector: readonly number[] }[];
          usage?: { promptTokens?: number; totalTokens?: number };
          targetUsed?: string;
          providerUsed?: string;
        };

        let rawVectors: readonly (readonly number[])[] = [];
        if (Array.isArray(data.vectors)) {
          rawVectors = data.vectors;
        } else if (Array.isArray(data.embeddings)) {
          rawVectors = data.embeddings
            .slice()
            .sort((a, b) => a.index - b.index)
            .map((item) => item.vector);
        }

        const promptTokens = data.usage?.promptTokens ?? 0;
        const totalTokens = data.usage?.totalTokens ?? promptTokens;

        return {
          vectors: rawVectors,
          usage: {
            promptTokens,
            totalTokens,
          },
          targetUsed: data.targetUsed,
          providerUsed: data.providerUsed,
        };
      }

      await this.handleErrorResponse(response, payload);
      throw new ProviderExecutionFailedError('Unexpected error response from Model Gateway');
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError('Embedding dispatch was cancelled by the caller');
      }
      if (
        err instanceof InvalidRequestError ||
        err instanceof AuthenticationError ||
        err instanceof ForbiddenError ||
        err instanceof RateLimitedError ||
        err instanceof RequestCancelledError ||
        err instanceof DeadlineExceededError ||
        err instanceof ModelUnavailableError ||
        err instanceof ProviderExecutionFailedError
      ) {
        throw err;
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('timeout')) {
        throw new DeadlineExceededError(`Model Gateway call timed out: ${msg}`);
      }
      if (msg.toLowerCase().includes('abort')) {
        throw new RequestCancelledError(`Model Gateway call aborted: ${msg}`);
      }

      throw new ProviderExecutionFailedError(
        `Failed to communicate with Model Gateway at ${this.baseUrl}: ${msg}`,
      );
    } finally {
      clearTimeout(timeoutHandle);
      if (signal) {
        signal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  public async checkHealth(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health/readiness`, {
        method: 'GET',
        headers: this.internalToken ? { Authorization: `Bearer ${this.internalToken}` } : {},
        ...(signal ? { signal } : {}),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildHeaders(payload: EmbeddingDispatchPayload): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Request-ID': payload.requestId,
      'X-Correlation-ID': payload.correlationId,
      'X-Service-Name': 'embeddings',
    };

    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }
    if (payload.tenantId) {
      headers['X-Tenant-ID'] = payload.tenantId;
    }
    if (payload.userId) {
      headers['X-User-ID'] = payload.userId;
    }
    if (payload.actorId) {
      headers['X-Actor-ID'] = payload.actorId;
    }
    if (payload.deadlineMs !== undefined) {
      headers['X-Deadline-At'] = new Date(payload.deadlineMs).toISOString();
    }

    return headers;
  }

  private async handleErrorResponse(
    response: Response,
    payload: EmbeddingDispatchPayload,
  ): Promise<never> {
    let errorCode = 'PROVIDER_EXECUTION_FAILED';
    let errorMessage = `Model Gateway failed with HTTP ${response.status}`;
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
      // Body was not JSON
    }

    switch (response.status) {
      case 400:
        throw new InvalidRequestError(errorMessage, details);
      case 401:
        throw new AuthenticationError(errorMessage);
      case 403:
        throw new ForbiddenError(errorMessage);
      case 429:
        throw new RateLimitedError(errorMessage, details);
      case 499:
        throw new RequestCancelledError(errorMessage);
      case 503:
        throw new ModelUnavailableError(
          `Target models unavailable for '${payload.canonicalModelId}': ${errorMessage}`,
        );
      case 504:
        throw new DeadlineExceededError(errorMessage);
      default:
        throw new ProviderExecutionFailedError(
          `Model Gateway provider execution failed (${errorCode}): ${errorMessage}`,
        );
    }
  }
}
