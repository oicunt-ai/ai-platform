import type { ToolAuditEvent } from '../../domain/index.js';
import type { ToolAuditRepositoryPort } from '../../application/ports/tool-audit-repository.port.js';

export class InMemoryToolAuditRepository implements ToolAuditRepositoryPort {
  private readonly events: ToolAuditEvent[] = [];

  public async record(event: ToolAuditEvent): Promise<void> {
    this.events.push(event);
  }

  public async listByTenant(tenantId: string, limit = 100): Promise<readonly ToolAuditEvent[]> {
    const matching = this.events
      .filter((e) => e.tenantId === tenantId)
      .slice(-limit)
      .reverse();

    return Object.freeze(matching);
  }

  public getAll(): readonly ToolAuditEvent[] {
    return Object.freeze([...this.events]);
  }

  public clear(): void {
    this.events.length = 0;
  }
}
