import type { CanonicalToolDefinition } from '../../domain/types.js';
import type {
  DiscoveredMcpTool,
  GatewayExecuteToolCommand,
  GatewayToolExecutionOutcome,
  ToolsServicePort,
} from '../../application/ports/tools-service.port.js';

export class HttpToolsClient implements ToolsServicePort {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken?: string | undefined,
  ) {}

  public async registerTool(tool: CanonicalToolDefinition, tenantId?: string): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.internalToken) {
      headers['X-Internal-Token'] = this.internalToken;
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }
    if (tenantId) {
      headers['X-Tenant-Id'] = tenantId;
    }

    const res = await fetch(`${this.baseUrl}/internal/v1/tools/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(tool),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to register tool '${tool.toolId}': HTTP ${res.status} ${text}`);
    }
  }

  public async listTools(
    tenantId: string,
    actorId: string,
    roles?: readonly string[] | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<readonly DiscoveredMcpTool[]> {
    const url = new URL(`${this.baseUrl}/internal/v1/tools`);
    url.searchParams.set('format', 'mcp');

    const headers: Record<string, string> = {
      'X-Tenant-ID': tenantId,
      'X-Actor-ID': actorId,
    };
    if (roles && roles.length > 0) {
      headers['X-Actor-Roles'] = roles.join(',');
    }
    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
      headers['X-Internal-Token'] = this.internalToken;
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers,
      ...(signal ? { signal } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to discover tools from Tools Service: HTTP ${res.status} ${text}`);
    }

    const body = (await res.json()) as any;
    const tools = body.tools ?? body.data?.tools ?? [];
    return tools as DiscoveredMcpTool[];
  }

  public async executeTool(
    command: GatewayExecuteToolCommand,
  ): Promise<GatewayToolExecutionOutcome> {
    const url = `${this.baseUrl}/internal/v1/tools/execute`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-ID': command.tenantId,
      'X-User-ID': command.userId,
      'X-Actor-ID': command.actorId,
      'X-Correlation-ID': command.correlationId,
      'X-Request-ID': command.requestId,
    };
    if (command.roles && command.roles.length > 0) {
      headers['X-Actor-Roles'] = command.roles.join(',');
    }
    if (command.deadlineAt) {
      headers['X-Deadline-At'] = command.deadlineAt;
    }
    if (command.deadlineMs) {
      headers['X-Deadline-Ms'] = String(command.deadlineMs);
    }
    if (command.idempotencyKey) {
      headers['Idempotency-Key'] = command.idempotencyKey;
    }
    if (this.internalToken) {
      headers['Authorization'] = `Bearer ${this.internalToken}`;
      headers['X-Internal-Token'] = this.internalToken;
    }

    const startTime = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          callId: command.callId,
          toolId: command.toolId,
          arguments: command.arguments,
          confirmationToken: command.confirmationToken,
        }),
        ...(command.signal ? { signal: command.signal } : {}),
      });

      const durationMs = Date.now() - startTime;

      if (res.ok) {
        const body = (await res.json()) as any;
        const data = body.data ?? body;
        return {
          status: 'success',
          output: data.output ?? data.result ?? data,
          textSummary: data.textSummary,
          durationMs: data.execution?.durationMs ?? durationMs,
        };
      }

      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { message: await res.text() };
      }

      const err = errorBody.error ?? errorBody;

      // Handle confirmation required
      if (
        (res.status === 403 || res.status === 428) &&
        (err.code === 'CONFIRMATION_REQUIRED' || err.details?.challenge || err.challenge)
      ) {
        const challenge = err.details?.challenge ?? err.challenge ?? {};
        return {
          status: 'confirmation_required',
          challenge: {
            confirmationId: challenge.confirmationId,
            challengeToken: challenge.challengeToken ?? challenge.token ?? '',
            toolId: command.toolId,
            expiresAt: challenge.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          },
          durationMs,
        };
      }

      return {
        status: 'failure',
        error: {
          code: err.code ?? `HTTP_${res.status}`,
          message: err.message ?? `Tool execution failed with status ${res.status}`,
          retryable: Boolean(err.retryable || res.status === 503 || res.status === 504),
          details: err.details,
        },
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      if (command.signal?.aborted) {
        return {
          status: 'failure',
          error: {
            code: 'REQUEST_CANCELLED',
            message: 'Tool execution was cancelled',
            retryable: false,
          },
          durationMs,
        };
      }

      return {
        status: 'failure',
        error: {
          code: 'TOOL_UNAVAILABLE',
          message: `Failed to contact Tools Service: ${(err as Error).message}`,
          retryable: true,
        },
        durationMs,
      };
    }
  }
}

export class InMemoryToolsService implements ToolsServicePort {
  public readonly registeredTools: CanonicalToolDefinition[] = [];
  public readonly mockTools: DiscoveredMcpTool[] = [];
  public lastExecutedCommand?: GatewayExecuteToolCommand | undefined;

  public async registerTool(tool: CanonicalToolDefinition, _tenantId?: string): Promise<void> {
    const existingIdx = this.registeredTools.findIndex((t) => t.toolId === tool.toolId);
    if (existingIdx >= 0) {
      this.registeredTools[existingIdx] = tool;
    } else {
      this.registeredTools.push(tool);
    }
  }

  public addMockTool(tool: DiscoveredMcpTool): void {
    this.mockTools.push(tool);
  }

  public async listTools(
    _tenantId: string,
    _actorId: string,
    _roles?: readonly string[] | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<readonly DiscoveredMcpTool[]> {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    const projected: DiscoveredMcpTool[] = this.registeredTools
      .filter((t) => t.status === 'active')
      .map((t) => ({
        name: t.toolId,
        description: t.description,
        inputSchema: t.parameters as unknown as Record<string, unknown>,
      }));

    return [...projected, ...this.mockTools];
  }

  public async executeTool(
    command: GatewayExecuteToolCommand,
  ): Promise<GatewayToolExecutionOutcome> {
    this.lastExecutedCommand = command;
    if (command.signal?.aborted) {
      return {
        status: 'failure',
        error: {
          code: 'REQUEST_CANCELLED',
          message: 'Tool execution was cancelled',
          retryable: false,
        },
        durationMs: 1,
      };
    }

    // Check registered or mock tools
    const tool = this.registeredTools.find((t) => t.toolId === command.toolId);
    const mockTool = this.mockTools.find((t) => t.name === command.toolId);

    if (!tool && !mockTool) {
      return {
        status: 'failure',
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool '${command.toolId}' not found`,
          retryable: false,
        },
        durationMs: 1,
      };
    }

    // Confirmation test logic
    if (tool?.capabilities.requiresConfirmation || (mockTool as any)?.requiresConfirmation) {
      if (!command.confirmationToken) {
        return {
          status: 'confirmation_required',
          challenge: {
            confirmationId: `conf_${Date.now()}`,
            challengeToken: `chlg_${command.toolId}_${Date.now()}`,
            toolId: command.toolId,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          },
          durationMs: 1,
        };
      }

      if (
        command.confirmationToken !== 'valid-confirmation-token' &&
        !command.confirmationToken.startsWith('chlg_') &&
        !command.confirmationToken.startsWith('conf_')
      ) {
        return {
          status: 'failure',
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Invalid confirmation token',
            retryable: false,
          },
          durationMs: 1,
        };
      }
    }

    if (command.toolId === 'fail_tool' || (command.arguments as any)?.shouldFail) {
      return {
        status: 'failure',
        error: {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'Deliberate tool failure',
          retryable: false,
        },
        durationMs: 2,
      };
    }

    return {
      status: 'success',
      output: {
        success: true,
        toolId: command.toolId,
        args: command.arguments,
      },
      textSummary: `Tool ${command.toolId} executed successfully`,
      durationMs: 2,
    };
  }

  public clear(): void {
    this.registeredTools.length = 0;
    this.mockTools.length = 0;
  }
}
