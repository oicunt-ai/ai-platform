import { describe, expect, it } from 'vitest';
import { AuditEvent } from '../../src/domain/index.js';
import { InMemoryAuditRepository } from '../../src/infrastructure/repositories/in-memory-audit.repository.js';

describe('Audit Persistence Specification', () => {
  it('appends and queries audit events by entity', async () => {
    const auditRepo = new InMemoryAuditRepository();

    const event1 = new AuditEvent({
      entityType: 'canonical_model',
      entityId: 'oicunt.model.catalog-alpha',
      action: 'CREATE',
      actorId: 'admin-1',
      correlationId: 'corr-1',
      afterState: { id: 'oicunt.model.catalog-alpha' },
    });

    const event2 = new AuditEvent({
      entityType: 'canonical_model',
      entityId: 'oicunt.model.catalog-alpha',
      action: 'UPDATE',
      actorId: 'admin-2',
      correlationId: 'corr-2',
      reason: 'Updated display name',
      afterState: { id: 'oicunt.model.catalog-alpha', displayName: 'New Name' },
    });

    await auditRepo.append(event1);
    await auditRepo.append(event2);

    const history = await auditRepo.listByEntity('canonical_model', 'oicunt.model.catalog-alpha');
    expect(history).toHaveLength(2);
    expect(history[0]?.action).toBe('UPDATE'); // latest first
    expect(history[1]?.action).toBe('CREATE');
  });

  it('queries recent audit events bounded by limit', async () => {
    const auditRepo = new InMemoryAuditRepository();

    for (let i = 0; i < 5; i++) {
      await auditRepo.append(
        new AuditEvent({
          entityType: 'model_version',
          entityId: `ver-${i}`,
          action: 'STATUS_CHANGE',
          actorId: 'system',
          correlationId: `corr-${i}`,
          afterState: { index: i },
        }),
      );
    }

    const recent = await auditRepo.listRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.entityId).toBe('ver-4');
  });
});
