import type { ToolAuditEvent } from '../../domain/index.js';

export interface ToolAuditRepositoryPort {
  record(event: ToolAuditEvent): Promise<void>;
  listByTenant(tenantId: string, limit?: number): Promise<readonly ToolAuditEvent[]>;
}
