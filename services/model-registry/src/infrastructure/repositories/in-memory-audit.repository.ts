import type { AuditRepositoryPort } from '../../application/ports/audit-repository.port.js';
import type { AuditEntityType, AuditEvent } from '../../domain/index.js';

export class InMemoryAuditRepository implements AuditRepositoryPort {
  private readonly events: AuditEvent[] = [];

  public async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  public async listByEntity(
    entityType: AuditEntityType,
    entityId: string,
  ): Promise<readonly AuditEvent[]> {
    return Object.freeze(
      this.events.filter((e) => e.entityType === entityType && e.entityId === entityId).reverse(),
    );
  }

  public async listRecent(limit = 100): Promise<readonly AuditEvent[]> {
    return Object.freeze([...this.events].reverse().slice(0, limit));
  }

  public clear(): void {
    this.events.length = 0;
  }
}
