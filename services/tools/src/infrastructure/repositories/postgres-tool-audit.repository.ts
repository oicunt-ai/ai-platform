import type { ToolAuditEvent, ToolId } from '../../domain/index.js';
import type { ToolAuditRepositoryPort } from '../../application/ports/tool-audit-repository.port.js';
import type { DatabasePool } from '../database/connection.js';

interface AuditRow {
  audit_id: string;
  execution_id: string;
  timestamp: string;
  tenant_id: string;
  user_id: string;
  actor_id: string;
  tool_id: string;
  version: string;
  is_read_only: boolean;
  sanitized_arguments: unknown;
  status: string;
  duration_ms: number;
  confirmation_token_used: string | null;
  client_ip: string | null;
  correlation_id: string;
}

export class PostgresToolAuditRepository implements ToolAuditRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async record(event: ToolAuditEvent): Promise<void> {
    await this.db.query(
      `
      INSERT INTO oicunt_tools.tool_audit_logs (
        audit_id, execution_id, timestamp, tenant_id, user_id, actor_id,
        tool_id, version, is_read_only, sanitized_arguments, status,
        duration_ms, confirmation_token_used, client_ip, correlation_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        event.auditId,
        event.executionId,
        event.timestamp,
        event.tenantId,
        event.userId,
        event.actorId,
        event.toolId,
        event.version,
        event.isReadOnly,
        JSON.stringify(event.sanitizedArguments),
        event.status,
        event.durationMs,
        event.confirmationTokenUsed ?? null,
        event.clientIp ?? null,
        event.correlationId,
      ],
    );
  }

  public async listByTenant(tenantId: string, limit = 100): Promise<readonly ToolAuditEvent[]> {
    const result = await this.db.query<AuditRow>(
      `
      SELECT audit_id, execution_id, timestamp, tenant_id, user_id, actor_id,
             tool_id, version, is_read_only, sanitized_arguments, status,
             duration_ms, confirmation_token_used, client_ip, correlation_id
      FROM oicunt_tools.tool_audit_logs
      WHERE tenant_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
      `,
      [tenantId, limit],
    );

    const events: ToolAuditEvent[] = result.rows.map((row) => ({
      auditId: row.audit_id,
      executionId: row.execution_id,
      timestamp: row.timestamp,
      tenantId: row.tenant_id,
      userId: row.user_id,
      actorId: row.actor_id,
      toolId: row.tool_id as ToolId,
      version: row.version,
      isReadOnly: row.is_read_only,
      sanitizedArguments:
        typeof row.sanitized_arguments === 'string'
          ? (JSON.parse(row.sanitized_arguments) as Record<string, unknown>)
          : (row.sanitized_arguments as Record<string, unknown>),
      status: row.status as 'success' | 'failure',
      durationMs: row.duration_ms,
      confirmationTokenUsed: row.confirmation_token_used ?? undefined,
      clientIp: row.client_ip ?? undefined,
      correlationId: row.correlation_id,
    }));

    return Object.freeze(events);
  }
}
