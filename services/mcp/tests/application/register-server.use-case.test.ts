import { describe, expect, it } from 'vitest';
import { RegisterServerUseCase } from '../../src/application/use-cases/register-server.use-case.js';
import { InMemoryMcpServerRepository } from '../../src/infrastructure/repositories/in-memory-mcp-server.repository.js';
import {
  McpInvalidRequestError,
  McpSecurityError,
  McpServerConflictError,
} from '../../src/domain/errors.js';

describe('RegisterServerUseCase', () => {
  it('registers a valid streamable_http server', async () => {
    const repo = new InMemoryMcpServerRepository();
    const useCase = new RegisterServerUseCase(repo);

    const reg = await useCase.execute({
      tenantId: 'tenant-1',
      name: 'GitHub Server',
      description: 'GitHub MCP integration',
      transportType: 'streamable_http',
      transportConfig: {
        type: 'streamable_http',
        config: { url: 'https://api.github.com/mcp' },
      },
      authSecretRef: 'sec_github_token',
    });

    expect(reg.serverId).toContain('github_server_');
    expect(reg.name).toBe('GitHub Server');
    expect(reg.tenantId).toBe('tenant-1');
    expect(reg.status).toBe('inactive');

    const saved = await repo.findById(reg.serverId, 'tenant-1');
    expect(saved).not.toBeNull();
  });

  it('rejects duplicate server names within the same tenant', async () => {
    const repo = new InMemoryMcpServerRepository();
    const useCase = new RegisterServerUseCase(repo);

    await useCase.execute({
      tenantId: 'tenant-1',
      name: 'Postgres DB',
      transportType: 'stdio',
      transportConfig: {
        type: 'stdio',
        config: { command: 'node' },
      },
    });

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        name: 'Postgres DB',
        transportType: 'stdio',
        transportConfig: {
          type: 'stdio',
          config: { command: 'node' },
        },
      }),
    ).rejects.toThrow(McpServerConflictError);
  });

  it('rejects stdio commands with shell metacharacters', async () => {
    const repo = new InMemoryMcpServerRepository();
    const useCase = new RegisterServerUseCase(repo);

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        name: 'Malicious Server',
        transportType: 'stdio',
        transportConfig: {
          type: 'stdio',
          config: { command: 'sh -c "whoami; rm -rf /"' },
        },
      }),
    ).rejects.toThrow(McpSecurityError);
  });

  it('rejects invalid or missing transport configs', async () => {
    const repo = new InMemoryMcpServerRepository();
    const useCase = new RegisterServerUseCase(repo);

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        name: 'Bad URL',
        transportType: 'streamable_http',
        transportConfig: {
          type: 'streamable_http',
          config: { url: 'ftp://bad-protocol.com' },
        },
      }),
    ).rejects.toThrow(McpInvalidRequestError);
  });
});
