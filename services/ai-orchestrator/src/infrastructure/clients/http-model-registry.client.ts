import type {
  ModelResolutionQuery,
  ModelResolutionResult,
} from '../../application/dtos/resolution.dto.js';
import type { ModelRegistryPort } from '../../application/ports/model-registry.port.js';
import {
  AllTargetsExhaustedError,
  InvalidRequestError,
  ModelDeprecatedError,
  ModelInMaintenanceError,
  ModelNotFoundError,
  RegistryUnavailableError,
  RequestCancelledError,
  UnsupportedEffortLevelError,
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
    if (query.effort) {
      url.searchParams.set('effort', query.effort);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Service-Name': 'ai-orchestrator',
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
        throw new RequestCancelledError();
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

      // Handle non-200 responses
      let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
      try {
        errorBody = (await response.json()) as typeof errorBody;
      } catch {
        // Body was not JSON
      }

      const code = errorBody.error?.code ?? '';
      const message = errorBody.error?.message ?? `Model Registry returned HTTP ${response.status}`;

      if (response.status === 404 || code === 'MODEL_NOT_FOUND') {
        throw new ModelNotFoundError(query.canonicalModelId, query.correlationId);
      }
      if (response.status === 410 || code === 'MODEL_DEPRECATED') {
        throw new ModelDeprecatedError(query.canonicalModelId, query.correlationId);
      }
      if (code === 'MODEL_IN_MAINTENANCE') {
        throw new ModelInMaintenanceError(query.canonicalModelId, query.correlationId);
      }
      if (code === 'NO_ELIGIBLE_TARGETS') {
        throw new AllTargetsExhaustedError(message, query.correlationId);
      }
      if (
        response.status === 400 &&
        (code === 'UNSUPPORTED_EFFORT_LEVEL' || code === 'UNSUPPORTED_EFFORT')
      ) {
        throw new UnsupportedEffortLevelError(
          query.canonicalModelId,
          query.effort,
          undefined,
          query.correlationId,
        );
      }
      if (response.status === 400) {
        throw new InvalidRequestError(message, query.correlationId);
      }

      throw new RegistryUnavailableError(message, query.correlationId);
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError();
      }
      if (
        err instanceof ModelNotFoundError ||
        err instanceof ModelDeprecatedError ||
        err instanceof ModelInMaintenanceError ||
        err instanceof AllTargetsExhaustedError ||
        err instanceof UnsupportedEffortLevelError ||
        err instanceof InvalidRequestError ||
        err instanceof RegistryUnavailableError
      ) {
        throw err;
      }

      throw new RegistryUnavailableError(
        err instanceof Error ? err.message : String(err),
        query.correlationId,
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
        ...(signal ? { signal } : {}),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
