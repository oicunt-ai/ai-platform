import type {
  CheckpointTurnRequest,
  ContextRetrievalOptions,
  HydratedConversationContext,
  MemoryCallContext,
  MemoryPort,
} from '../../application/ports/memory.port.js';
import {
  AuthenticationError,
  ForbiddenError,
  InferenceTimeoutError,
  InvalidRequestError,
  OrchestratorError,
  RequestCancelledError,
} from '../../domain/errors.js';
import { createInternalServiceToken } from '../security/internal-service-token.js';

export interface HttpMemoryClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
}

export class HttpMemoryClient implements MemoryPort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;

  constructor(options: HttpMemoryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
  }

  public async createConversation(
    body: unknown,
    context: MemoryCallContext,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.requestJson('/internal/v1/memory/conversations', 'POST', context, body, signal);
  }

  public async listConversations(
    context: MemoryCallContext,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.requestJson('/internal/v1/memory/conversations', 'GET', context, undefined, signal);
  }

  public async listMessages(
    conversationId: string,
    context: MemoryCallContext,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.requestJson(
      `/internal/v1/memory/conversations/${encodeURIComponent(conversationId)}/messages`,
      'GET',
      context,
      undefined,
      signal,
    );
  }

  public async getContext(
    conversationId: string,
    options: ContextRetrievalOptions,
    context: MemoryCallContext,
    signal?: AbortSignal,
  ): Promise<HydratedConversationContext> {
    const url = `${this.baseUrl}/internal/v1/memory/conversations/${encodeURIComponent(conversationId)}/context`;
    const headers = this.buildHeaders(context);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(options),
        ...(signal ? { signal } : {}),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          success: boolean;
          data: HydratedConversationContext;
        };
        return body.data;
      }

      await this.handleErrorResponse(response, context);
      throw new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'Unexpected error response from Memory Service',
        500,
        false,
        undefined,
        undefined,
        context.correlationId,
      );
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError(
          'Memory context retrieval was cancelled by the caller.',
          context.correlationId,
        );
      }
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw this.mapUnknownError(err, context);
    }
  }

  public async checkpointTurn(
    request: CheckpointTurnRequest,
    context: MemoryCallContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${this.baseUrl}/internal/v1/memory/conversations/${encodeURIComponent(request.conversationId)}/messages`;
    const headers = this.buildHeaders(context);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          turnId: request.turnId,
          messages: request.messages,
        }),
        ...(signal ? { signal } : {}),
      });

      if (response.ok) {
        return;
      }

      await this.handleErrorResponse(response, context);
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError(
          'Memory turn checkpoint was cancelled by the caller.',
          context.correlationId,
        );
      }
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw this.mapUnknownError(err, context);
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

  private buildHeaders(context: MemoryCallContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      'X-Service-Name': 'ai-orchestrator',
      'X-Correlation-ID': context.correlationId,
      'X-Request-ID': context.requestId,
    };

    if (context.turnId) {
      headers['X-Turn-ID'] = context.turnId;
    }
    if (context.tenantId) {
      headers['X-Tenant-ID'] = context.tenantId;
    }
    if (context.userId) {
      headers['X-User-ID'] = context.userId;
    }
    if (context.actorId) {
      headers['X-Actor-ID'] = context.actorId;
    }
    if (context.deadlineMs !== undefined) {
      headers['X-Deadline-Ms'] = String(context.deadlineMs);
    }
    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${createInternalServiceToken({
        issuer: 'ai-orchestrator',
        audience: 'memory',
        secret: this.internalToken,
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId,
        correlationId: context.correlationId,
      })}`;
    }

    return headers;
  }

  private async requestJson(
    path: string,
    method: 'GET' | 'POST',
    context: MemoryCallContext,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(context),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) await this.handleErrorResponse(response, context);
    const payload = (await response.json()) as { data?: unknown };
    return payload.data ?? payload;
  }

  private async handleErrorResponse(
    response: Response,
    context: MemoryCallContext,
  ): Promise<never> {
    let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // Body not JSON
    }

    const code = errorBody.error?.code ?? '';
    const message = errorBody.error?.message ?? `Memory Service returned HTTP ${response.status}`;

    if (code === 'STORAGE_TIMEOUT' || response.status === 504) {
      throw new InferenceTimeoutError(message, context.correlationId);
    }
    if (code === 'REQUEST_CANCELLED' || response.status === 499) {
      throw new RequestCancelledError(message, context.correlationId);
    }
    if (
      code === 'CONVERSATION_DELETED' ||
      code === 'CONVERSATION_NOT_FOUND' ||
      code === 'INVALID_REQUEST' ||
      response.status === 400 ||
      response.status === 404 ||
      response.status === 410
    ) {
      throw new InvalidRequestError(message, context.correlationId);
    }
    if (code === 'AUTHENTICATION_ERROR' || response.status === 401) {
      throw new AuthenticationError(message, context.correlationId);
    }
    if (code === 'FORBIDDEN' || response.status === 403) {
      throw new ForbiddenError(message, context.correlationId);
    }

    throw new OrchestratorError(
      'INTERNAL_ORCHESTRATOR_ERROR',
      message,
      response.status >= 500 ? 503 : response.status,
      response.status >= 500,
      undefined,
      undefined,
      context.correlationId,
    );
  }

  private mapUnknownError(err: unknown, context: MemoryCallContext): OrchestratorError {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('cancel')) {
        return new RequestCancelledError(
          'Memory request was cancelled by the caller.',
          context.correlationId,
        );
      }
      if (msg.includes('timeout')) {
        return new InferenceTimeoutError(err.message, context.correlationId);
      }
      return new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        err.message,
        503,
        true,
        undefined,
        undefined,
        context.correlationId,
      );
    }
    return new OrchestratorError(
      'INTERNAL_ORCHESTRATOR_ERROR',
      'Unknown Memory Service error',
      503,
      true,
      undefined,
      undefined,
      context.correlationId,
    );
  }
}
