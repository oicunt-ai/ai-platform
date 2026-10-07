import { describe, expect, it } from 'vitest';
import { DiscoverCapabilitiesUseCase } from '../../src/application/use-cases/discover-capabilities.use-case.js';
import { InMemoryMcpServerRepository } from '../../src/infrastructure/repositories/in-memory-mcp-server.repository.js';
import { InMemoryToolsService } from '../../src/infrastructure/clients/http-tools.client.js';
import type { McpClientRuntimePort } from '../../src/application/ports/mcp-client-runtime.port.js';
import type { McpTransportPort } from '../../src/application/ports/mcp-transport.port.js';
import type { McpServerRegistration } from '../../src/domain/types.js';

class MockTransport implements McpTransportPort {
  public connected = true;
  public sentRequests: Array<{ method: string; params: unknown }> = [];
  public sentNotifications: Array<{ method: string; params: unknown }> = [];

  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {
    this.connected = false;
  }
  public isConnected(): boolean {
    return this.connected;
  }

  public async sendNotification(method: string, params?: unknown): Promise<void> {
    this.sentNotifications.push({ method, params });
  }

  public onNotification(): void {}
  public onClose(): void {}

  public async sendRequest<T = any>(method: string, params?: unknown): Promise<T> {
    this.sentRequests.push({ method, params });

    if (method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'test-mcp-server', version: '1.0.0' },
      } as T;
    }

    if (method === 'tools/list') {
      return {
        tools: [
          {
            name: 'execute_sql',
            description: 'Executes SQL query',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        ],
      } as T;
    }

    if (method === 'resources/list') {
      return {
        resources: [
          {
            uri: 'postgres://schema/public',
            name: 'Public Schema',
            mimeType: 'application/json',
          },
        ],
      } as T;
    }

    if (method === 'prompts/list') {
      return {
        prompts: [
          {
            name: 'explain_query',
            description: 'Explain SQL execution plan',
            arguments: [{ name: 'query', required: true }],
          },
        ],
      } as T;
    }

    throw new Error(`Unexpected method ${method}`);
  }
}

describe('DiscoverCapabilitiesUseCase', () => {
  it('performs protocol handshake, discovers primitives, and registers canonical tools', async () => {
    const repo = new InMemoryMcpServerRepository();
    const toolsService = new InMemoryToolsService();
    const mockTransport = new MockTransport();

    const mockRuntime: McpClientRuntimePort = {
      getOrCreateSession: async () => mockTransport,
      disconnectSession: async () => {},
      isSessionActive: () => true,
      onToolsListChanged: () => {},
    };

    const server: McpServerRegistration = {
      serverId: 'pg_srv',
      tenantId: 'tenant-123',
      name: 'Postgres MCP',
      transportType: 'stdio',
      transportConfig: { type: 'stdio', config: { command: 'node' } },
      status: 'inactive',
      protocolVersion: '2024-11-05',
      capabilities: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.save(server);

    const useCase = new DiscoverCapabilitiesUseCase(repo, mockRuntime, toolsService);
    const discovered = await useCase.execute('pg_srv', 'tenant-123');

    // 1. Verify handshake was sent
    expect(mockTransport.sentRequests[0]?.method).toBe('initialize');
    expect(mockTransport.sentNotifications[0]?.method).toBe('notifications/initialized');

    // 2. Verify tools discovered and normalized into canonical Tools service
    expect(discovered.tools).toHaveLength(1);
    expect(discovered.tools[0]?.originalName).toBe('execute_sql');
    expect(discovered.tools[0]?.canonicalToolId).toBe('oicunt.tool.mcp.pg_srv.execute_sql');
    expect(toolsService.registeredTools).toHaveLength(1);
    expect(toolsService.registeredTools[0]?.toolId).toBe('oicunt.tool.mcp.pg_srv.execute_sql');
    expect(toolsService.registeredTools[0]?.source).toBe('mcp');

    // 3. Verify resources & prompts discovered but STRICTLY NOT registered as tools
    expect(discovered.resources).toHaveLength(1);
    expect(discovered.resources[0]?.uri).toBe('postgres://schema/public');
    expect(discovered.prompts).toHaveLength(1);
    expect(discovered.prompts[0]?.name).toBe('explain_query');

    // None of resources/prompts leaked into toolsService
    expect(toolsService.registeredTools.some((t) => t.toolId.includes('postgres://'))).toBe(false);
    expect(toolsService.registeredTools.some((t) => t.toolId.includes('explain_query'))).toBe(
      false,
    );

    // 4. Verify server updated to active status
    const updatedServer = await repo.findById('pg_srv', 'tenant-123');
    expect(updatedServer?.status).toBe('active');
    expect(updatedServer?.lastDiscoveredAt).toBeDefined();
  });
});
