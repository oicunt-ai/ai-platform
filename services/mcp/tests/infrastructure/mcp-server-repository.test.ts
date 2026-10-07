import { describe, expect, it } from 'vitest';
import { InMemoryMcpServerRepository } from '../../src/infrastructure/repositories/in-memory-mcp-server.repository.js';
import type { McpServerRegistration } from '../../src/domain/types.js';

describe('InMemoryMcpServerRepository', () => {
  it('saves, retrieves, and enforces tenant isolation', async () => {
    const repo = new InMemoryMcpServerRepository();

    const serverTenant1: McpServerRegistration = {
      serverId: 'srv_1',
      tenantId: 'tenant-a',
      name: 'Server A',
      transportType: 'streamable_http',
      transportConfig: {
        type: 'streamable_http',
        config: { url: 'https://example.com/mcp' },
      },
      status: 'active',
      protocolVersion: '2024-11-05',
      capabilities: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const serverTenant2: McpServerRegistration = {
      ...serverTenant1,
      serverId: 'srv_2',
      tenantId: 'tenant-b',
      name: 'Server B',
    };

    await repo.save(serverTenant1);
    await repo.save(serverTenant2);

    // Tenant A queries
    const foundA = await repo.findById('srv_1', 'tenant-a');
    expect(foundA?.name).toBe('Server A');

    // Cross-tenant access blocked
    const crossAccess = await repo.findById('srv_1', 'tenant-b');
    expect(crossAccess).toBeNull();

    // Listing by tenant
    const listA = await repo.listByTenant('tenant-a');
    expect(listA).toHaveLength(1);
    expect(listA[0]?.serverId).toBe('srv_1');

    // Discovered capabilities persistence
    await repo.saveDiscoveredCapabilities('srv_1', 'tenant-a', {
      tools: [
        {
          id: 'oicunt.tool.mcp.srv_1.tool1',
          serverId: 'srv_1',
          tenantId: 'tenant-a',
          originalName: 'tool1',
          canonicalToolId: 'oicunt.tool.mcp.srv_1.tool1' as any,
          description: 'Test Tool 1',
          inputSchema: { type: 'object', properties: {} },
          schemaHash: 'hash123',
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      resources: [],
      prompts: [],
      rawServerCapabilities: {},
    });

    const caps = await repo.getDiscoveredCapabilities('srv_1', 'tenant-a');
    expect(caps?.tools).toHaveLength(1);
    expect(caps?.tools[0]?.originalName).toBe('tool1');

    const foundTool = await repo.findTool('oicunt.tool.mcp.srv_1.tool1');
    expect(foundTool?.originalName).toBe('tool1');
  });
});
