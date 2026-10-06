import type {
  AgentInferenceRequest,
  AgentInferenceResponse,
  InferenceClientPort,
} from '../../application/ports/inference-client.port.js';
import {
  DeadlineExceededError,
  InferenceFailureError,
  RequestCancelledError,
} from '../../domain/errors.js';

export interface HttpInferenceClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string | undefined;
}

export class HttpInferenceClient implements InferenceClientPort {
  private readonly baseUrl: string;
  private readonly internalToken?: string | undefined;

  constructor(options: HttpInferenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
  }

  public async execute(
    request: AgentInferenceRequest,
    signal?: AbortSignal | undefined,
  ): Promise<AgentInferenceResponse> {
    const url = `${this.baseUrl}/internal/v1/inference/execute`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-ID': request.tenantId,
      'X-User-ID': request.actorId,
      'X-Actor-ID': request.actorId,
      'X-Correlation-ID': request.correlationId,
    };

    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requestId: request.requestId,
          correlationId: request.correlationId,
          canonicalModelId: request.canonicalModelId,
          messages: request.messages,
          tools: request.tools,
          effort: request.effort,
          stream: false,
          deadlineMs: request.deadlineMs,
        }),
        ...(signal ? { signal } : {}),
      });

      if (response.ok) {
        const body = (await response.json()) as any;
        // Inference response shape: { data: { completionId, message, finishReason, usage } } or top-level
        const data = body.data ?? body;
        return {
          completionId: data.completionId ?? data.id ?? `comp_${Date.now()}`,
          message: data.message,
          finishReason: data.finishReason ?? 'stop',
          usage: data.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }

      if (response.status === 504) {
        throw new DeadlineExceededError(request.correlationId, request.deadlineMs);
      }

      let errorText = '';
      try {
        const errJson = (await response.json()) as any;
        errorText = errJson.error?.message ?? errJson.message ?? JSON.stringify(errJson);
      } catch {
        errorText = await response.text();
      }

      throw new InferenceFailureError(
        `Inference Service returned status ${response.status}: ${errorText}`,
        { status: response.status, body: errorText },
      );
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new RequestCancelledError('Inference request was cancelled');
      }
      if (err instanceof DeadlineExceededError || err instanceof InferenceFailureError) {
        throw err;
      }
      throw new InferenceFailureError(
        `Failed to reach Inference Service: ${(err as Error).message}`,
        { originalError: String(err) },
      );
    }
  }
}
