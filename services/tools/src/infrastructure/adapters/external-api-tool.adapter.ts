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

export interface VaultSecretProvider {
  getSecret(secretKey: string, tenantId: string): Promise<string | null>;
}

export class ExternalApiToolAdapter implements ToolExecutorPort {
  constructor(private readonly vaultProvider?: VaultSecretProvider | undefined) {}

  public async execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();
    const targetUrlStr =
      (request.arguments['url'] as string) || (request.metadata?.['targetUrl'] as string);

    if (!targetUrlStr) {
      throw new InvalidToolArgumentsError(
        `External API tool '${definition.toolId}' requires a valid target URL in arguments or metadata`,
      );
    }

    // SSRF Check - strictly validates protocol, host, and IP
    const parsedUrl = SsrfGuard.validateUrl(targetUrlStr);

    const headers: Record<string, string> = {
      'User-Agent': 'OICUNT-Tools-Service/1.0',
      'X-Correlation-ID': context.correlationId,
    };

    // Inject Vault secret if specified in metadata
    const secretKey = request.metadata?.['secretKey'] as string | undefined;
    if (secretKey && this.vaultProvider) {
      const secret = await this.vaultProvider.getSecret(secretKey, context.tenantId);
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
    }

    const method = (request.arguments['method'] as string)?.toUpperCase() || 'GET';
    const body =
      method !== 'GET' && method !== 'HEAD' && request.arguments['body']
        ? JSON.stringify(request.arguments['body'])
        : undefined;

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined) {
      fetchOptions.body = body;
    }
    if (context.cancellationSignal !== undefined) {
      fetchOptions.signal = context.cancellationSignal;
    }

    try {
      const response = await fetch(parsedUrl.toString(), fetchOptions);

      const responseText = await response.text();
      let parsedOutput: unknown;
      try {
        parsedOutput = JSON.parse(responseText);
      } catch {
        parsedOutput = responseText;
      }

      if (!response.ok) {
        throw new ToolExecutionFailedError(
          `External API returned HTTP ${response.status}`,
          definition.capabilities.isReadOnly,
          { status: response.status, body: parsedOutput },
        );
      }

      return {
        executionId: context.executionId,
        callId: request.callId,
        status: 'success',
        output: parsedOutput,
        textSummary: `External API call to ${parsedUrl.hostname} succeeded with status ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      if (context.cancellationSignal?.aborted) {
        throw err;
      }
      if (err instanceof ToolExecutionFailedError) {
        throw err;
      }
      throw new ToolUnavailableError(
        `External API network call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
