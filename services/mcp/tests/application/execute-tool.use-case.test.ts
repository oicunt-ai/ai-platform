import { describe, expect, it } from 'vitest';
import { ExecuteToolUseCase } from '../../src/application/use-cases/execute-tool.use-case.js';
import { InMemoryMcpServerRepository } from '../../src/infrastructure/repositories/in-memory-mcp-server.repository.js';
import type { McpClientRuntimePort } from '../../src/application/ports/mcp-client-runtime.port.js';
import type { McpTransportPort } from '../../src/application/ports/mcp-transport.port.js';
import type { McpServerRegistration } from '../../src/domain/types.js';
import { McpInvalidRequestError, McpServerNotFoundError } from '../../src/domain/errors.js';

class MockExecutionTransport implements McpTransportPort {
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

  public async sendRequest<T = any>(
    method: string,
    params?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    this.sentRequests.push({ method, params });

    if (options?.signal?.aborted) {
      throw new Error('Aborted');
    }

    if (method === 'tools/call') {
      return {
        content: [{ type: 'text', text: 'Result from MCP tool' }],
        isError: false,
      } as T;
    }

    throw new Error(`Unknown method ${method}`);
  }
}

describe('ExecuteToolUseCase', () => {
  it('executes active MCP tool successfully through transport', async () => {
    const repo = new InMemoryMcpServerRepository();
    const mockTransport = new MockExecutionTransport();

    const mockRuntime: McpClientRuntimePort = {
      getOrCreateSession: async () => mockTransport,
      disconnectSession: async () => {},
      isSessionActive: () => true,
      onToolsListChanged: () => {},
    };

    const server: McpServerRegistration = {
      serverId: 'srv_1',
      tenantId: 'tenant-100',
      name: 'Server 1',
      transportType: 'stdio',
      transportConfig: { type: 'stdio', config: { command: 'node' } },
      status: 'active',
      protocolVersion: '2024-11-05',
      capabilities: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.save(server);

    await repo.saveDiscoveredCapabilities('srv_1', 'tenant-100', {
      tools: [
        {
          id: 'oicunt.tool.mcp.srv_1.my_tool',
          serverId: 'srv_1',
          tenantId: 'tenant-100',
          originalName: 'my_tool',
          canonicalToolId: 'oicunt.tool.mcp.srv_1.my_tool' as any,
          description: 'A tool',
          inputSchema: { type: 'object', properties: {} },
          schemaHash: 'hash',
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      resources: [],
      prompts: [],
      rawServerCapabilities: {},
    });

    const useCase = new ExecuteToolUseCase(repo, mockRuntime);

    const result = await useCase.execute({
      tenantId: 'tenant-100',
      serverId: 'srv_1',
      toolName: 'my_tool',
      arguments: { param1: 'val1' },
      actorId: 'user-42',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'Result from MCP tool' }]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(mockTransport.sentRequests).toHaveLength(1);
    expect(mockTransport.sentRequests[0]?.method).toBe('tools/call');
    expect(mockTransport.sentRequests[0]?.params).toEqual({
      name: 'my_tool',
      arguments: { param1: 'val1' },
    });
  });

  it('enforces tenant isolation and rejects cross-tenant execution', async () => {
    const repo = new InMemoryMcpServerRepository();
    const mockTransport = new MockExecutionTransport();

    const mockRuntime: McpClientRuntimePort = {
      getOrCreateSession: async () => mockTransport,
      disconnectSession: async () => {},
      isSessionActive: () => true,
      onToolsListChanged: () => {},
    };

    const server: McpServerRegistration = {
      serverId: 'srv_1',
      tenantId: 'tenant-100',
      name: 'Server 1',
      transportType: 'stdio',
      transportConfig: { type: 'stdio', config: { command: 'node' } },
      status: 'active',
      protocolVersion: '2024-11-05',
      capabilities: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.save(server);

    const useCase = new ExecuteToolUseCase(repo, mockRuntime);

    // Call from tenant-999 for server owned by tenant-100
    await expect(
      useCase.execute({
        tenantId: 'tenant-999',
        serverId: 'srv_1',
        toolName: 'my_tool',
        arguments: {},
      }),
    ).rejects.toThrow(McpServerNotFoundError);
  });

  it('rejects execution of unregistered tools', async () => {
    const repo = new InMemoryMcpServerRepository();
    const mockTransport = new MockExecutionTransport();

    const mockRuntime: McpClientRuntimePort = {
      getOrCreateSession: async () => mockTransport,
      disconnectSession: async () => {},
      isSessionActive: () => true,
      onToolsListChanged: () => {},
    };

    const server: McpServerRegistration = {
      serverId: 'srv_1',
      tenantId: 'tenant-100',
      name: 'Server 1',
      transportType: 'stdio',
      transportConfig: { type: 'stdio', config: { command: 'node' } },
      status: 'active',
      protocolVersion: '2024-11-05',
      capabilities: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.save(server);

    const useCase = new ExecuteToolUseCase(repo, mockRuntime);

    await expect(
      useCase.execute({
        tenantId: 'tenant-100',
        serverId: 'srv_1',
        toolName: 'non_existent_tool',
        arguments: {},
      }),
    ).rejects.toThrow(McpInvalidRequestError);
  });
});
