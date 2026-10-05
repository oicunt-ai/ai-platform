import type { AuditRepositoryPort } from '../../application/ports/audit-repository.port.js';
import type { AuditEntityType, AuditEvent } from '../../domain/index.js';
import { AuditEvent as AuditEventEntity } from '../../domain/audit-event.js';
import type { DatabasePool } from '../database/connection.js';

interface AuditEventRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  correlation_id: string;
  reason: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown>;
  created_at: Date;
}

export class PostgresAuditRepository implements AuditRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async append(event: AuditEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO model_registry.audit_events
        (id, entity_type, entity_id, action, actor_id, correlation_id, reason, before_state, after_state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        event.auditId,
        event.entityType,
        event.entityId,
        event.action,
        event.actorId,
        event.correlationId,
        event.reason ?? null,
        event.beforeState ? JSON.stringify(event.beforeState) : null,
        JSON.stringify(event.afterState),
        event.timestamp,
      ],
    );
  }

  public async listByEntity(
    entityType: AuditEntityType,
    entityId: string,
  ): Promise<readonly AuditEvent[]> {
    const res = await this.db.query<AuditEventRow>(
      `SELECT * FROM model_registry.audit_events
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY created_at DESC, id DESC`,
      [entityType, entityId],
    );

    return Object.freeze(res.rows.map((row) => this.mapRowToEntity(row)));
  }

  public async listRecent(limit = 100): Promise<readonly AuditEvent[]> {
    const res = await this.db.query<AuditEventRow>(
      `SELECT * FROM model_registry.audit_events
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [limit],
    );

    return Object.freeze(res.rows.map((row) => this.mapRowToEntity(row)));
  }

  private mapRowToEntity(row: AuditEventRow): AuditEvent {
    return new AuditEventEntity({
      auditId: row.id,
      entityType: row.entity_type as AuditEntityType,
      entityId: row.entity_id,
      action: row.action as AuditEvent['action'],
      actorId: row.actor_id,
      correlationId: row.correlation_id,
      reason: row.reason ?? undefined,
      beforeState: row.before_state ?? undefined,
      afterState: row.after_state,
      timestamp: row.created_at.toISOString(),
    });
  }
}
