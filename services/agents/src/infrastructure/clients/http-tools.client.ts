import type {
  AgentToolExecutionOutcome,
  AgentToolExecutionRequest,
  ToolsClientPort,
} from '../../application/ports/tools-client.port.js';
import { RequestCancelledError } from '../../domain/errors.js';

export interface HttpToolsClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
}

export class HttpToolsClient implements ToolsClientPort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;

  constructor(options: HttpToolsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
  }

  public async executeTool(
    request: AgentToolExecutionRequest,
    signal?: AbortSignal | undefined,
  ): Promise<AgentToolExecutionOutcome> {
    const url = `${this.baseUrl}/internal/v1/tools/execute`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-ID': request.tenantId,
      'X-User-ID': request.actorId,
      'X-Actor-ID': request.actorId,
      'X-Correlation-ID': request.correlationId,
      'X-Call-ID': request.callId,
      'Idempotency-Key': request.callId,
    };

    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          toolId: request.toolId,
          callId: request.callId,
          arguments: request.arguments,
          confirmationToken: request.confirmationToken ?? null,
          timeoutMs: request.timeoutMs,
        }),
        ...(signal ? { signal } : {}),
      });

      const durationMs = Date.now() - startTime;

      if (response.ok) {
        const body = (await response.json()) as any;
        const data = body.data ?? body;
        return {
          status: 'success',
          output: data.output ?? data.result ?? data,
          artifacts: data.artifacts,
          durationMs: data.durationMs ?? durationMs,
        };
      }

      // Check if confirmation required
      let errorBody: any = null;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { message: await response.text() };
      }

      const err = errorBody.error ?? errorBody;
      if (
        (response.status === 428 || response.status === 403) &&
        (err.code === 'CONFIRMATION_REQUIRED' || err.challenge)
      ) {
        const challenge = err.challenge ?? err.details?.challenge ?? {};
        return {
          status: 'confirmation_required',
          challenge: {
            confirmationId: challenge.confirmationId ?? `conf_${Date.now()}`,
            challengeToken: challenge.challengeToken ?? challenge.token ?? '',
            toolId: request.toolId,
            callId: request.callId,
            arguments: request.arguments,
            expiresAt: challenge.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          },
        };
      }

      return {
        status: 'failure',
        error: {
          code: err.code ?? `HTTP_${response.status}`,
          message: err.message ?? `Tool execution failed with status ${response.status}`,
          retryable: Boolean(err.retryable || response.status === 503 || response.status === 504),
        },
        durationMs,
      };
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError('Tool execution was cancelled');
      }

      const durationMs = Date.now() - startTime;
      return {
        status: 'failure',
        error: {
          code: 'NETWORK_ERROR',
          message: `Failed to contact Tools Service: ${(err as Error).message}`,
          retryable: true,
        },
        durationMs,
      };
    }
  }
}
