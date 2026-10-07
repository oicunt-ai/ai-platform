import type {
  McpDiscoveredCapabilities,
  McpServerId,
  McpServerRegistration,
  McpServerStatus,
  McpToolDescriptor,
} from '../../domain/types.js';

export interface McpServerRepositoryPort {
  findById(serverId: McpServerId, tenantId?: string): Promise<McpServerRegistration | null>;
  findByName(name: string, tenantId: string): Promise<McpServerRegistration | null>;
  listByTenant(tenantId: string): Promise<readonly McpServerRegistration[]>;
  save(server: McpServerRegistration): Promise<void>;
  updateStatus(
    serverId: McpServerId,
    tenantId: string,
    status: McpServerStatus,
    errorDetails?: unknown,
  ): Promise<void>;
  delete(serverId: McpServerId, tenantId: string): Promise<boolean>;
  saveDiscoveredCapabilities(
    serverId: McpServerId,
    tenantId: string,
    capabilities: McpDiscoveredCapabilities,
  ): Promise<void>;
  getDiscoveredCapabilities(
    serverId: McpServerId,
    tenantId: string,
  ): Promise<McpDiscoveredCapabilities | null>;
  findTool(canonicalToolId: string): Promise<McpToolDescriptor | null>;
}
