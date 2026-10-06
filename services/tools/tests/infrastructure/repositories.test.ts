import { describe, expect, it } from 'vitest';
import {
  InMemoryToolAuditRepository,
  InMemoryToolRepository,
} from '../../src/infrastructure/repositories/index.js';
import { BUILT_IN_TOOLS, type ToolAuditEvent } from '../../src/domain/index.js';

describe('Tools In-Memory Repositories', () => {
  it('saves and retrieves tool definitions and versions', async () => {
    const repo = new InMemoryToolRepository();
    const tool = BUILT_IN_TOOLS[0]!;

    await repo.saveTool(tool);

    const foundLatest = await repo.findById(tool.toolId);
    expect(foundLatest).toEqual(tool);

    const foundVersion = await repo.findById(tool.toolId, '1.0.0');
    expect(foundVersion).toEqual(tool);

    const notFound = await repo.findById(tool.toolId, '9.9.9');
    expect(notFound).toBeNull();
  });

  it('records and queries audit trail events', async () => {
    const auditRepo = new InMemoryToolAuditRepository();
    const event: ToolAuditEvent = {
      auditId: 'aud_1',
      executionId: 'exec_1',
      timestamp: new Date().toISOString(),
      tenantId: 'tenant_aud',
      userId: 'usr_1',
      actorId: 'act_1',
      toolId: 'oicunt.tool.computation.evaluate',
      version: '1.0.0',
      isReadOnly: true,
      sanitizedArguments: { expression: '1 + 1' },
      status: 'success',
      durationMs: 5,
      correlationId: 'corr_aud',
    };

    await auditRepo.record(event);
    const listed = await auditRepo.listByTenant('tenant_aud');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.executionId).toBe('exec_1');
  });
});
