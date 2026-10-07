import type {
  McpDiscoveredCapabilities,
  McpServerId,
  McpServerRegistration,
  McpServerStatus,
  McpToolDescriptor,
} from '../../domain/types.js';
import type { McpServerRepositoryPort } from '../../application/ports/mcp-server-repository.port.js';

export class InMemoryMcpServerRepository implements McpServerRepositoryPort {
  private readonly servers = new Map<string, McpServerRegistration>();
  private readonly capabilities = new Map<string, McpDiscoveredCapabilities>();

  private makeKey(serverId: string, tenantId: string): string {
    return `${tenantId}::${serverId}`;
  }

  public async findById(
    serverId: McpServerId,
    tenantId?: string,
  ): Promise<McpServerRegistration | null> {
    if (tenantId) {
      return this.servers.get(this.makeKey(serverId, tenantId)) ?? null;
    }
    for (const server of this.servers.values()) {
      if (server.serverId === serverId) {
        return server;
      }
    }
    return null;
  }

  public async findByName(name: string, tenantId: string): Promise<McpServerRegistration | null> {
    for (const server of this.servers.values()) {
      if (server.tenantId === tenantId && server.name.toLowerCase() === name.toLowerCase()) {
        return server;
      }
    }
    return null;
  }

  public async listByTenant(tenantId: string): Promise<readonly McpServerRegistration[]> {
    const list: McpServerRegistration[] = [];
    for (const server of this.servers.values()) {
      if (server.tenantId === tenantId) {
        list.push(server);
      }
    }
    return list;
  }

  public async save(server: McpServerRegistration): Promise<void> {
    this.servers.set(this.makeKey(server.serverId, server.tenantId), { ...server });
  }

  public async updateStatus(
    serverId: McpServerId,
    tenantId: string,
    status: McpServerStatus,
  ): Promise<void> {
    const key = this.makeKey(serverId, tenantId);
    const existing = this.servers.get(key);
    if (existing) {
      this.servers.set(key, {
        ...existing,
        status,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  public async delete(serverId: McpServerId, tenantId: string): Promise<boolean> {
    const key = this.makeKey(serverId, tenantId);
    const deleted = this.servers.delete(key);
    this.capabilities.delete(key);
    return deleted;
  }

  public async saveDiscoveredCapabilities(
    serverId: McpServerId,
    tenantId: string,
    capabilities: McpDiscoveredCapabilities,
  ): Promise<void> {
    const key = this.makeKey(serverId, tenantId);
    this.capabilities.set(key, { ...capabilities });
  }

  public async getDiscoveredCapabilities(
    serverId: McpServerId,
    tenantId: string,
  ): Promise<McpDiscoveredCapabilities | null> {
    const key = this.makeKey(serverId, tenantId);
    return this.capabilities.get(key) ?? null;
  }

  public async findTool(canonicalToolId: string): Promise<McpToolDescriptor | null> {
    for (const caps of this.capabilities.values()) {
      for (const tool of caps.tools) {
        if (tool.canonicalToolId === canonicalToolId) {
          return tool;
        }
      }
    }
    return null;
  }

  public clear(): void {
    this.servers.clear();
    this.capabilities.clear();
  }
}
