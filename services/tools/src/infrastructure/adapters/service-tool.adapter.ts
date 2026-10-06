import type { ToolDefinition, ToolExecutionRequest } from '../../domain/index.js';
import {
  InvalidToolArgumentsError,
  SsrfGuard,
  ToolExecutionFailedError,
  ToolUnavailableError,
} from '../../domain/index.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolExecutorPort,
} from '../../application/ports/tool-executor.port.js';

export class ServiceToolAdapter implements ToolExecutorPort {
  constructor(private readonly internalToken?: string | undefined) {}

  public async execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();
    const endpoint = request.arguments['endpoint'] ?? request.metadata?.['endpoint'];
    if (typeof endpoint !== 'string' || !endpoint.trim()) {
      throw new InvalidToolArgumentsError(
        `Service tool '${definition.toolId}' requires a valid target endpoint in arguments or metadata`,
      );
    }

    // SSRF Check
    const parsedUrl = SsrfGuard.validateUrl(endpoint);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-ID': context.tenantId,
      'X-Correlation-ID': context.correlationId,
      'X-Caller-ID': context.callerId,
    };

    if (context.userId) headers['X-User-ID'] = context.userId;
    if (context.actorId) headers['X-Actor-ID'] = context.actorId;
    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(request.arguments),
    };
    if (context.cancellationSignal !== undefined) {
      fetchOptions.signal = context.cancellationSignal;
    }

    try {
      const response = await fetch(parsedUrl.toString(), fetchOptions);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        if (response.status === 503 || response.status === 504) {
          throw new ToolUnavailableError(
            `Service tool upstream unavailable (${response.status}): ${errorText}`,
          );
        }
        throw new ToolExecutionFailedError(
          `Service tool returned HTTP ${response.status}: ${errorText}`,
          definition.capabilities.isReadOnly,
        );
      }

      const responseData = (await response.json()) as unknown;
      return {
        executionId: context.executionId,
        callId: request.callId,
        status: 'success',
        output: responseData,
        textSummary: `Service '${definition.toolId}' executed successfully`,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      if (context.cancellationSignal?.aborted) {
        throw err;
      }
      if (err instanceof ToolUnavailableError || err instanceof ToolExecutionFailedError) {
        throw err;
      }
      throw new ToolUnavailableError(
        `Failed to reach service tool upstream: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
