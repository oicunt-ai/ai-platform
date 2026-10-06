import type {
  ModelRegistryPort,
  ModelResolutionQuery,
  ModelResolutionResult,
} from '../../application/ports/model-registry.port.js';
import {
  DeadlineExceededError,
  InvalidRequestError,
  ModelUnavailableError,
  RequestCancelledError,
  UnsupportedCapabilityError,
  UnsupportedModelError,
} from '../../domain/errors.js';

export interface HttpModelRegistryClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export class HttpModelRegistryClient implements ModelRegistryPort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: HttpModelRegistryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  public async resolveModel(
    query: ModelResolutionQuery,
    signal?: AbortSignal,
  ): Promise<ModelResolutionResult> {
    const url = new URL(
      `${this.baseUrl}/internal/v1/models/resolve/${encodeURIComponent(query.canonicalModelId)}`,
    );

    if (query.version) {
      url.searchParams.set('version', query.version);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Service-Name': 'embeddings',
      'X-Correlation-ID': query.correlationId,
    };

    if (query.tenantId) {
      headers['X-Tenant-ID'] = query.tenantId;
    }
    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error('Model Registry request timed out'));
    }, this.timeoutMs);

    const onParentAbort = (): void => {
      abortController.abort(signal?.reason);
    };

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutHandle);
        throw new RequestCancelledError('Operation was cancelled prior to resolving model');
      }
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      if (response.ok) {
        const body = (await response.json()) as {
          success?: boolean;
          data?: ModelResolutionResult;
        } & ModelResolutionResult;

        return (body.data ?? body) as ModelResolutionResult;
      }

      let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
      try {
        errorBody = (await response.json()) as typeof errorBody;
      } catch {
        // Response was not JSON
      }

      const code = errorBody.error?.code ?? '';
      const message = errorBody.error?.message ?? `Model Registry returned HTTP ${response.status}`;

      if (response.status === 404 || code === 'MODEL_NOT_FOUND') {
        throw new UnsupportedModelError(query.canonicalModelId);
      }
      if (code === 'UNSUPPORTED_CAPABILITY') {
        throw new UnsupportedCapabilityError(query.canonicalModelId, 'embedding');
      }
      if (response.status === 400) {
        throw new InvalidRequestError(message);
      }
      if (
        response.status === 503 ||
        code === 'MODEL_UNAVAILABLE' ||
        code === 'NO_ELIGIBLE_TARGETS'
      ) {
        throw new ModelUnavailableError(
          `Model '${query.canonicalModelId}' has no available targets in Model Registry: ${message}`,
        );
      }

      throw new ModelUnavailableError(
        `Failed to resolve model '${query.canonicalModelId}' from Model Registry: ${message}`,
      );
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError('Request cancelled while resolving model');
      }
      if (
        err instanceof UnsupportedModelError ||
        err instanceof UnsupportedCapabilityError ||
        err instanceof InvalidRequestError ||
        err instanceof ModelUnavailableError ||
        err instanceof DeadlineExceededError ||
        err instanceof RequestCancelledError
      ) {
        throw err;
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('aborted')) {
        throw new DeadlineExceededError(`Model resolution timed out: ${msg}`);
      }

      throw new ModelUnavailableError(
        `Unable to connect to Model Registry at ${this.baseUrl}: ${msg}`,
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
}
