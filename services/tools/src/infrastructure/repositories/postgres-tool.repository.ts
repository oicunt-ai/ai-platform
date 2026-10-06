import type {
  AsyncExecutionJob,
  TenantToolEntitlement,
  ToolCapabilities,
  ToolCategory,
  ToolDefinition,
  ToolId,
  ToolOutputSchema,
  ToolParametersSchema,
  ToolSource,
  ToolStatus,
} from '../../domain/index.js';
import type {
  ToolCatalogFilter,
  ToolRepositoryPort,
} from '../../application/ports/tool-repository.port.js';
import type { DatabasePool } from '../database/connection.js';

interface ToolRow {
  id: string;
  name: string;
  category: string;
  source: string;
  status: string;
}

interface ToolVersionRow {
  tool_id: string;
  version: string;
  display_name: string;
  description: string;
  parameters_schema: unknown;
  output_schema: unknown;
  capabilities: unknown;
  timeout_policy: unknown;
  tags: unknown;
  is_deprecated: boolean;
}

interface ToolJoinedRow extends ToolRow, ToolVersionRow {}

export class PostgresToolRepository implements ToolRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async findById(toolId: ToolId, version?: string): Promise<ToolDefinition | null> {
    if (version) {
      const sql = `
        SELECT t.id, t.name, t.category, t.source, t.status,
               v.tool_id, v.version, v.display_name, v.description,
               v.parameters_schema, v.output_schema, v.capabilities,
               v.timeout_policy, v.tags, v.is_deprecated
        FROM oicunt_tools.tools t
        JOIN oicunt_tools.tool_versions v ON t.id = v.tool_id
        WHERE t.id = $1 AND v.version = $2
        LIMIT 1
      `;
      const result = await this.db.query<ToolJoinedRow>(sql, [toolId, version]);
      if (result.rows.length === 0 || !result.rows[0]) {
        return null;
      }
      return this.mapToDefinition(result.rows[0]);
    }

    // Latest version
    const sql = `
      SELECT t.id, t.name, t.category, t.source, t.status,
             v.tool_id, v.version, v.display_name, v.description,
             v.parameters_schema, v.output_schema, v.capabilities,
             v.timeout_policy, v.tags, v.is_deprecated
      FROM oicunt_tools.tools t
      JOIN oicunt_tools.tool_versions v ON t.id = v.tool_id
      WHERE t.id = $1
      ORDER BY v.published_at DESC
      LIMIT 1
    `;
    const result = await this.db.query<ToolJoinedRow>(sql, [toolId]);
    if (result.rows.length === 0 || !result.rows[0]) {
      return null;
    }
    return this.mapToDefinition(result.rows[0]);
  }

  public async listTools(filter?: ToolCatalogFilter): Promise<readonly ToolDefinition[]> {
    let sql = `
      SELECT DISTINCT ON (t.id)
             t.id, t.name, t.category, t.source, t.status,
             v.tool_id, v.version, v.display_name, v.description,
             v.parameters_schema, v.output_schema, v.capabilities,
             v.timeout_policy, v.tags, v.is_deprecated
      FROM oicunt_tools.tools t
      JOIN oicunt_tools.tool_versions v ON t.id = v.tool_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND t.status = $${params.length}`;
    }
    if (filter?.category) {
      params.push(filter.category);
      sql += ` AND t.category = $${params.length}`;
    }
    if (filter?.source) {
      params.push(filter.source);
      sql += ` AND t.source = $${params.length}`;
    }
    if (filter?.isReadOnly !== undefined) {
      params.push(filter.isReadOnly);
      sql += ` AND (v.capabilities->>'isReadOnly')::boolean = $${params.length}`;
    }
    if (filter?.hasSideEffects !== undefined) {
      params.push(filter.hasSideEffects);
      sql += ` AND (v.capabilities->>'hasSideEffects')::boolean = $${params.length}`;
    }

    sql += ` ORDER BY t.id, v.published_at DESC`;

    const result = await this.db.query<ToolJoinedRow>(sql, params);
    const definitions = result.rows.map((row) => this.mapToDefinition(row));

    // In-memory filter for product or tags if needed
    if (filter?.product || filter?.tag) {
      const matchTag = filter.product ?? filter.tag!;
      return definitions.filter((d) => d.tags.includes(matchTag));
    }

    return Object.freeze(definitions);
  }

  public async saveTool(definition: ToolDefinition): Promise<void> {
    await this.db.withTransaction(async (client) => {
      // Upsert root tool
      await client.query(
        `
        INSERT INTO oicunt_tools.tools (id, name, category, source, status, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          source = EXCLUDED.source,
          status = EXCLUDED.status,
          updated_at = NOW()
        `,
        [
          definition.toolId,
          definition.displayName,
          definition.category,
          definition.source,
          definition.status,
        ],
      );

      // Insert immutable version
      await client.query(
        `
        INSERT INTO oicunt_tools.tool_versions (
          tool_id, version, display_name, description,
          parameters_schema, output_schema, capabilities,
          timeout_policy, tags, published_at, is_deprecated
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
        `,
        [
          definition.toolId,
          definition.version,
          definition.displayName,
          definition.description,
          JSON.stringify(definition.parameters),
          definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
          JSON.stringify(definition.capabilities),
          JSON.stringify(definition.timeoutPolicy),
          JSON.stringify(definition.tags),
          definition.status === 'deprecated',
        ],
      );
    });
  }

  public async getTenantEntitlement(
    tenantId: string,
    toolId: ToolId,
  ): Promise<TenantToolEntitlement | null> {
    const result = await this.db.query<{
      tenant_id: string;
      tool_id: string;
      is_enabled: boolean;
      allowed_roles: unknown;
      config_overrides: unknown;
    }>(
      `
      SELECT tenant_id, tool_id, is_enabled, allowed_roles, config_overrides
      FROM oicunt_tools.tenant_tool_configs
      WHERE tenant_id = $1 AND tool_id = $2
      LIMIT 1
      `,
      [tenantId, toolId],
    );

    if (result.rows.length === 0 || !result.rows[0]) {
      return null;
    }

    const row = result.rows[0];
    const allowedRoles = Array.isArray(row.allowed_roles)
      ? (row.allowed_roles as string[])
      : typeof row.allowed_roles === 'string'
        ? (JSON.parse(row.allowed_roles) as string[])
        : [];

    return {
      tenantId: row.tenant_id,
      toolId: row.tool_id as ToolId,
      isEnabled: row.is_enabled,
      allowedRoles: Object.freeze(allowedRoles),
      configOverrides:
        typeof row.config_overrides === 'string'
          ? (JSON.parse(row.config_overrides) as Record<string, unknown>)
          : (row.config_overrides as Record<string, unknown> | undefined),
    };
  }

  public async setTenantEntitlement(entitlement: TenantToolEntitlement): Promise<void> {
    await this.db.query(
      `
      INSERT INTO oicunt_tools.tenant_tool_configs (
        tenant_id, tool_id, is_enabled, allowed_roles, config_overrides, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (tenant_id, tool_id) DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        allowed_roles = EXCLUDED.allowed_roles,
        config_overrides = EXCLUDED.config_overrides,
        updated_at = NOW()
      `,
      [
        entitlement.tenantId,
        entitlement.toolId,
        entitlement.isEnabled,
        JSON.stringify(entitlement.allowedRoles),
        entitlement.configOverrides ? JSON.stringify(entitlement.configOverrides) : null,
      ],
    );
  }

  public async createAsyncExecution(job: AsyncExecutionJob): Promise<void> {
    await this.db.query(
      `
      INSERT INTO oicunt_tools.tool_async_executions (
        execution_id, call_id, tenant_id, user_id, actor_id, tool_id, version,
        status, result, error, created_at, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        job.executionId,
        job.callId,
        job.tenantId,
        job.userId,
        job.actorId,
        job.toolId,
        job.version,
        job.status,
        job.result ? JSON.stringify(job.result) : null,
        job.error ? JSON.stringify(job.error) : null,
        job.createdAt,
        job.completedAt ?? null,
      ],
    );
  }

  public async updateAsyncExecution(
    executionId: string,
    update: Partial<AsyncExecutionJob>,
  ): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [executionId];

    if (update.status !== undefined) {
      params.push(update.status);
      fields.push(`status = $${params.length}`);
    }
    if (update.result !== undefined) {
      params.push(JSON.stringify(update.result));
      fields.push(`result = $${params.length}`);
    }
    if (update.error !== undefined) {
      params.push(JSON.stringify(update.error));
      fields.push(`error = $${params.length}`);
    }
    if (update.completedAt !== undefined) {
      params.push(update.completedAt);
      fields.push(`completed_at = $${params.length}`);
    }

    if (fields.length === 0) {
      return;
    }

    await this.db.query(
      `UPDATE oicunt_tools.tool_async_executions SET ${fields.join(', ')} WHERE execution_id = $1`,
      params,
    );
  }

  public async getAsyncExecution(executionId: string): Promise<AsyncExecutionJob | null> {
    const result = await this.db.query<{
      execution_id: string;
      call_id: string;
      tenant_id: string;
      user_id: string;
      actor_id: string;
      tool_id: string;
      version: string;
      status: string;
      result: unknown;
      error: unknown;
      created_at: string;
      completed_at: string | null;
    }>(
      `
      SELECT execution_id, call_id, tenant_id, user_id, actor_id, tool_id, version,
             status, result, error, created_at, completed_at
      FROM oicunt_tools.tool_async_executions
      WHERE execution_id = $1
      LIMIT 1
      `,
      [executionId],
    );

    if (result.rows.length === 0 || !result.rows[0]) {
      return null;
    }

    const row = result.rows[0];
    return {
      executionId: row.execution_id,
      callId: row.call_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      actorId: row.actor_id,
      toolId: row.tool_id as ToolId,
      version: row.version,
      status: row.status as AsyncExecutionJob['status'],
      result:
        typeof row.result === 'string'
          ? (JSON.parse(row.result) as AsyncExecutionJob['result'])
          : (row.result as AsyncExecutionJob['result']),
      error:
        typeof row.error === 'string'
          ? (JSON.parse(row.error) as AsyncExecutionJob['error'])
          : (row.error as AsyncExecutionJob['error']),
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private mapToDefinition(row: ToolJoinedRow): ToolDefinition {
    const parameters =
      typeof row.parameters_schema === 'string'
        ? (JSON.parse(row.parameters_schema) as ToolParametersSchema)
        : (row.parameters_schema as ToolParametersSchema);

    const outputSchema =
      row.output_schema !== null && row.output_schema !== undefined
        ? typeof row.output_schema === 'string'
          ? (JSON.parse(row.output_schema) as ToolOutputSchema)
          : (row.output_schema as ToolOutputSchema)
        : undefined;

    const capabilities =
      typeof row.capabilities === 'string'
        ? (JSON.parse(row.capabilities) as ToolCapabilities)
        : (row.capabilities as ToolCapabilities);

    const timeoutPolicy =
      typeof row.timeout_policy === 'string'
        ? (JSON.parse(row.timeout_policy) as ToolDefinition['timeoutPolicy'])
        : (row.timeout_policy as ToolDefinition['timeoutPolicy']);

    const tags = Array.isArray(row.tags)
      ? (row.tags as string[])
      : typeof row.tags === 'string'
        ? (JSON.parse(row.tags) as string[])
        : [];

    return {
      toolId: row.id as ToolId,
      displayName: row.display_name,
      description: row.description,
      version: row.version,
      category: row.category as ToolCategory,
      source: row.source as ToolSource,
      capabilities,
      parameters,
      outputSchema,
      timeoutPolicy,
      status: row.is_deprecated ? 'deprecated' : (row.status as ToolStatus),
      tags: Object.freeze(tags),
    };
  }
}
