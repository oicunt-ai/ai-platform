import type { McpToolCaller } from './mcp-tool.adapter.js';
import type { ToolExecutionContext } from '../../application/ports/tool-executor.port.js';

export interface HttpMcpToolCallerOptions {
  readonly mcpServiceUrl: string;
  readonly internalToken?: string | undefined;
}

export class HttpMcpToolCaller implements McpToolCaller {
  constructor(private readonly options: HttpMcpToolCallerOptions) {}

  public async callTool(params: {
    readonly serverName: string;
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
    readonly context: ToolExecutionContext;
  }): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-ID': params.context.tenantId,
      'X-Correlation-ID': params.context.correlationId,
    };

    if (this.options.internalToken) {
      headers['X-Internal-Token'] = this.options.internalToken;
      headers['Authorization'] = `Bearer ${this.options.internalToken}`;
    }

    const res = await fetch(`${this.options.mcpServiceUrl}/internal/v1/mcp/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: params.context.tenantId,
        serverId: params.serverName,
        toolName: params.toolName,
        arguments: params.arguments,
        actorId: params.context.actorId,
        correlationId: params.context.correlationId,
        deadlineMs: params.context.timeoutMs ? Date.now() + params.context.timeoutMs : undefined,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      const message = errorBody?.error?.message ?? `MCP execution returned HTTP ${res.status}`;
      throw new Error(message);
    }

    const body = (await res.json()) as {
      success: boolean;
      data: { content: unknown[]; isError?: boolean };
    };

    if (body.data?.isError) {
      throw new Error(`MCP tool execution reported error: ${JSON.stringify(body.data.content)}`);
    }

    return body.data?.content ?? body.data;
  }
}
