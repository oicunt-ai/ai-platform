import type { McpServerId } from '../../domain/types.js';
import type { McpTransportPort } from './mcp-transport.port.js';

export interface McpClientRuntimePort {
  /**
   * Acquires or establishes an active connection to an external MCP server.
   * If a session is already active, returns it; otherwise establishes connection.
   */
  getOrCreateSession(serverId: McpServerId, tenantId: string): Promise<McpTransportPort>;

  /**
   * Disconnects and removes any active session for a server.
   */
  disconnectSession(serverId: McpServerId): Promise<void>;

  /**
   * Checks if an active session currently exists.
   */
  isSessionActive(serverId: McpServerId): boolean;

  /**
   * Subscribes to tools/list_changed notifications for a server.
   */
  onToolsListChanged(serverId: McpServerId, callback: () => Promise<void> | void): void;
}
