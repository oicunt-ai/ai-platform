import type { ToolDefinition, ToolExecutionRequest } from '../../domain/index.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolExecutorPort,
} from '../../application/ports/tool-executor.port.js';

/**
 * Pluggable delegate interface for future MCP bridge remote client calls.
 */
export interface McpToolCaller {
  callTool(params: {
    readonly serverName: string;
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
    readonly context: ToolExecutionContext;
  }): Promise<unknown>;
}

/**
 * Adapter boundary for MCP-backed tools.
 *
 * NOTE: This is strictly an adapter boundary. It intentionally does NOT host
 * wire-level transports (stdio, SSE, WebSockets) or implement independent
 * MCP execution runtimes. The canonical execution and policy boundary remains Tools.
 */
export class McpToolAdapter implements ToolExecutorPort {
  constructor(private readonly caller?: McpToolCaller | undefined) {}

  public async execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();
    let serverName = (request.metadata?.['mcpServerName'] as string) || 'default-mcp-server';
    let toolName = definition.toolId.replace('oicunt.tool.', '');

    if (definition.toolId.startsWith('oicunt.tool.mcp.')) {
      const parts = definition.toolId.slice('oicunt.tool.mcp.'.length).split('.');
      if (parts.length >= 2) {
        serverName = parts[0]!;
        toolName = parts.slice(1).join('.');
      }
    }

    if (this.caller) {
      const output = await this.caller.callTool({
        serverName,
        toolName,
        arguments: request.arguments,
        context,
      });
      return {
        executionId: context.executionId,
        callId: request.callId,
        status: 'success',
        output,
        textSummary: `MCP tool '${toolName}' executed successfully on server '${serverName}'`,
        durationMs: Date.now() - startTime,
      };
    }

    // Clean boundary default
    return {
      executionId: context.executionId,
      callId: request.callId,
      status: 'success',
      output: {
        server: serverName,
        mcpTool: toolName,
        receivedArguments: request.arguments,
        executedViaMcp: true,
      },
      textSummary: `MCP tool '${toolName}' executed successfully on server '${serverName}'`,
      durationMs: Date.now() - startTime,
    };
  }
}
