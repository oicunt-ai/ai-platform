import type { AuditEntityType, AuditEvent } from '../../domain/index.js';

export interface AuditRepositoryPort {
  append(event: AuditEvent): Promise<void>;
  listByEntity(entityType: AuditEntityType, entityId: string): Promise<readonly AuditEvent[]>;
  listRecent(limit?: number): Promise<readonly AuditEvent[]>;
}
