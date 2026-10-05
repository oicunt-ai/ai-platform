import type { OrchestratorToolDefinition } from '../../dtos/chat.dto.js';

export interface McpServerReference {
  readonly serverId: string;
  readonly transport: 'stdio' | 'sse' | 'websocket';
  readonly uri: string;
}

/**
 * Future extension port for Model Context Protocol (MCP) server discovery and tool proxying (services/mcp).
 */
export interface McpGatewayPort {
  /**
   * Discovers and lists available tools exposed by an MCP server.
   */
  listTools(server: McpServerReference): Promise<readonly OrchestratorToolDefinition[]>;

  /**
   * Invokes an MCP tool on the target server.
   */
  callTool(
    server: McpServerReference,
    toolName: string,
    argumentsPayload: Record<string, unknown>,
  ): Promise<unknown>;
}
