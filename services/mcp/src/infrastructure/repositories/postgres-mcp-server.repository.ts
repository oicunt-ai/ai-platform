import type {
  McpDiscoveredCapabilities,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpServerId,
  McpServerRegistration,
  McpServerStatus,
  McpToolDescriptor,
} from '../../domain/types.js';
import type { McpServerRepositoryPort } from '../../application/ports/mcp-server-repository.port.js';
import type { DatabasePool } from '../database/connection.js';

interface ServerRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  transport_type: string;
  transport_config: any;
  auth_secret_ref: string | null;
  status: string;
  protocol_version: string;
  capabilities: any;
  last_discovered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ToolRow {
  id: string;
  server_id: string;
  tenant_id: string;
  original_name: string;
  canonical_tool_id: string;
  description: string;
  input_schema: any;
  schema_hash: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ResourceRow {
  id: string;
  server_id: string;
  tenant_id: string;
  uri: string;
  name: string;
  description: string | null;
  mime_type: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PromptRow {
  id: string;
  server_id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  arguments: any;
  created_at: Date;
  updated_at: Date;
}

export class PostgresMcpServerRepository implements McpServerRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async findById(
    serverId: McpServerId,
    tenantId?: string,
  ): Promise<McpServerRegistration | null> {
    const query = tenantId
      ? 'SELECT * FROM oicunt_mcp.mcp_servers WHERE id = $1 AND tenant_id = $2'
      : 'SELECT * FROM oicunt_mcp.mcp_servers WHERE id = $1';
    const params = tenantId ? [serverId, tenantId] : [serverId];

    const result = await this.db.query<ServerRow>(query, params);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapServerRow(result.rows[0]!);
  }

  public async findByName(name: string, tenantId: string): Promise<McpServerRegistration | null> {
    const result = await this.db.query<ServerRow>(
      'SELECT * FROM oicunt_mcp.mcp_servers WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)',
      [tenantId, name],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapServerRow(result.rows[0]!);
  }

  public async listByTenant(tenantId: string): Promise<readonly McpServerRegistration[]> {
    const result = await this.db.query<ServerRow>(
      'SELECT * FROM oicunt_mcp.mcp_servers WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );
    return result.rows.map((row) => this.mapServerRow(row));
  }

  public async save(server: McpServerRegistration): Promise<void> {
    await this.db.query(
      `INSERT INTO oicunt_mcp.mcp_servers (
        id, tenant_id, name, description, transport_type, transport_config,
        auth_secret_ref, status, protocol_version, capabilities, last_discovered_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        transport_type = EXCLUDED.transport_type,
        transport_config = EXCLUDED.transport_config,
        auth_secret_ref = EXCLUDED.auth_secret_ref,
        status = EXCLUDED.status,
        protocol_version = EXCLUDED.protocol_version,
        capabilities = EXCLUDED.capabilities,
        last_discovered_at = EXCLUDED.last_discovered_at,
        updated_at = EXCLUDED.updated_at`,
      [
        server.serverId,
        server.tenantId,
        server.name,
        server.description ?? null,
        server.transportType,
        JSON.stringify(server.transportConfig),
        server.authSecretRef ?? null,
        server.status,
        server.protocolVersion,
        JSON.stringify(server.capabilities),
        server.lastDiscoveredAt ? new Date(server.lastDiscoveredAt) : null,
        new Date(server.createdAt),
        new Date(server.updatedAt),
      ],
    );
  }

  public async updateStatus(
    serverId: McpServerId,
    tenantId: string,
    status: McpServerStatus,
  ): Promise<void> {
    await this.db.query(
      `UPDATE oicunt_mcp.mcp_servers
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [status, serverId, tenantId],
    );
  }

  public async delete(serverId: McpServerId, tenantId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM oicunt_mcp.mcp_servers WHERE id = $1 AND tenant_id = $2',
      [serverId, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async saveDiscoveredCapabilities(
    serverId: McpServerId,
    tenantId: string,
    capabilities: McpDiscoveredCapabilities,
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      // 1. Tools
      await client.query('DELETE FROM oicunt_mcp.mcp_server_tools WHERE server_id = $1', [
        serverId,
      ]);
      for (const tool of capabilities.tools) {
        await client.query(
          `INSERT INTO oicunt_mcp.mcp_server_tools (
            id, server_id, tenant_id, original_name, canonical_tool_id,
            description, input_schema, schema_hash, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            tool.id,
            serverId,
            tenantId,
            tool.originalName,
            tool.canonicalToolId,
            tool.description,
            JSON.stringify(tool.inputSchema),
            tool.schemaHash,
            tool.isActive,
            new Date(tool.createdAt),
            new Date(tool.updatedAt),
          ],
        );
      }

      // 2. Resources
      await client.query('DELETE FROM oicunt_mcp.mcp_server_resources WHERE server_id = $1', [
        serverId,
      ]);
      for (const res of capabilities.resources) {
        await client.query(
          `INSERT INTO oicunt_mcp.mcp_server_resources (
            id, server_id, tenant_id, uri, name, description, mime_type, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            res.id,
            serverId,
            tenantId,
            res.uri,
            res.name,
            res.description ?? null,
            res.mimeType ?? null,
            new Date(res.createdAt),
            new Date(res.updatedAt),
          ],
        );
      }

      // 3. Prompts
      await client.query('DELETE FROM oicunt_mcp.mcp_server_prompts WHERE server_id = $1', [
        serverId,
      ]);
      for (const p of capabilities.prompts) {
        await client.query(
          `INSERT INTO oicunt_mcp.mcp_server_prompts (
            id, server_id, tenant_id, name, description, arguments, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            p.id,
            serverId,
            tenantId,
            p.name,
            p.description ?? null,
            JSON.stringify(p.arguments),
            new Date(p.createdAt),
            new Date(p.updatedAt),
          ],
        );
      }
    });
  }

  public async getDiscoveredCapabilities(
    serverId: McpServerId,
    tenantId: string,
  ): Promise<McpDiscoveredCapabilities | null> {
    const server = await this.findById(serverId, tenantId);
    if (!server) {
      return null;
    }

    const [toolsRes, resourcesRes, promptsRes] = await Promise.all([
      this.db.query<ToolRow>(
        'SELECT * FROM oicunt_mcp.mcp_server_tools WHERE server_id = $1 AND tenant_id = $2 ORDER BY original_name ASC',
        [serverId, tenantId],
      ),
      this.db.query<ResourceRow>(
        'SELECT * FROM oicunt_mcp.mcp_server_resources WHERE server_id = $1 AND tenant_id = $2 ORDER BY name ASC',
        [serverId, tenantId],
      ),
      this.db.query<PromptRow>(
        'SELECT * FROM oicunt_mcp.mcp_server_prompts WHERE server_id = $1 AND tenant_id = $2 ORDER BY name ASC',
        [serverId, tenantId],
      ),
    ]);

    const tools: McpToolDescriptor[] = toolsRes.rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      tenantId: row.tenant_id,
      originalName: row.original_name,
      canonicalToolId: row.canonical_tool_id as any,
      description: row.description,
      inputSchema:
        typeof row.input_schema === 'string' ? JSON.parse(row.input_schema) : row.input_schema,
      schemaHash: row.schema_hash,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));

    const resources: McpResourceDescriptor[] = resourcesRes.rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      tenantId: row.tenant_id,
      uri: row.uri,
      name: row.name,
      description: row.description ?? undefined,
      mimeType: row.mime_type ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));

    const prompts: McpPromptDescriptor[] = promptsRes.rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description ?? undefined,
      arguments: typeof row.arguments === 'string' ? JSON.parse(row.arguments) : row.arguments,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));

    return {
      tools,
      resources,
      prompts,
      rawServerCapabilities: server.capabilities,
    };
  }

  public async findTool(canonicalToolId: string): Promise<McpToolDescriptor | null> {
    const result = await this.db.query<ToolRow>(
      'SELECT * FROM oicunt_mcp.mcp_server_tools WHERE canonical_tool_id = $1',
      [canonicalToolId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0]!;
    return {
      id: row.id,
      serverId: row.server_id,
      tenantId: row.tenant_id,
      originalName: row.original_name,
      canonicalToolId: row.canonical_tool_id as any,
      description: row.description,
      inputSchema:
        typeof row.input_schema === 'string' ? JSON.parse(row.input_schema) : row.input_schema,
      schemaHash: row.schema_hash,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapServerRow(row: ServerRow): McpServerRegistration {
    return {
      serverId: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description ?? undefined,
      transportType: row.transport_type as any,
      transportConfig:
        typeof row.transport_config === 'string'
          ? JSON.parse(row.transport_config)
          : row.transport_config,
      authSecretRef: row.auth_secret_ref ?? undefined,
      status: row.status as any,
      protocolVersion: row.protocol_version,
      capabilities:
        typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities,
      lastDiscoveredAt: row.last_discovered_at ? row.last_discovered_at.toISOString() : undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
