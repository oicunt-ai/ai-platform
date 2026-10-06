import { beforeEach, describe, expect, it } from 'vitest';
import { BUILT_IN_TOOLS, type ToolDefinition } from '../../src/domain/index.js';
import { DiscoverToolsUseCase } from '../../src/application/use-cases/discover-tools.use-case.js';
import { InMemoryToolRepository } from '../../src/infrastructure/repositories/index.js';

describe('DiscoverToolsUseCase', () => {
  let repository: InMemoryToolRepository;
  let useCase: DiscoverToolsUseCase;

  beforeEach(async () => {
    repository = new InMemoryToolRepository();
    useCase = new DiscoverToolsUseCase(repository);

    for (const tool of BUILT_IN_TOOLS) {
      await repository.saveTool(tool);
    }
  });

  it('lists active tools for an entitled tenant', async () => {
    const discovered = await useCase.execute({
      tenantId: 'tenant_1',
      actorId: 'actor_1',
    });

    expect(discovered.length).toBeGreaterThanOrEqual(4);
  });

  it('filters out tools disabled for the tenant', async () => {
    await repository.setTenantEntitlement({
      tenantId: 'tenant_limited',
      toolId: 'oicunt.tool.computation.evaluate',
      isEnabled: false,
      allowedRoles: [],
    });

    const discovered = await useCase.execute({
      tenantId: 'tenant_limited',
      actorId: 'actor_1',
    });

    const ids = discovered.map((t) =>
      'toolId' in t ? t.toolId : (t as { function?: { name?: string } }).function?.name,
    );
    expect(ids).not.toContain('oicunt.tool.computation.evaluate');
  });

  it('filters by category and product tag', async () => {
    const discovered = await useCase.execute({
      tenantId: 'tenant_1',
      actorId: 'actor_1',
      product: 'billy',
    });

    expect(discovered.length).toBeGreaterThanOrEqual(1);
    const tool = discovered[0] as ToolDefinition;
    expect(tool.tags).toContain('billy');
  });

  it('exports tools in requested wire format (openai)', async () => {
    const discovered = await useCase.execute({
      tenantId: 'tenant_1',
      actorId: 'actor_1',
      format: 'openai',
    });

    expect(discovered[0]).toHaveProperty('type', 'function');
    expect(discovered[0]).toHaveProperty('function');
  });
});
