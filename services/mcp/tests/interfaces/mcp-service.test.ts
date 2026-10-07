import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpService } from '../../src/service.js';
import { loadMcpConfig } from '../../src/config.js';

describe('McpService HTTP Integration', () => {
  let service: McpService;
  let port: number;

  beforeEach(async () => {
    const config = loadMcpConfig({
      port: 0,
      useDatabase: false,
      logLevel: 'silent',
      allowLocalhost: true,
    });

    service = new McpService({ config });
    port = await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('responds to /health/liveness and /health/readiness probes', async () => {
    const liveRes = await fetch(`http://127.0.0.1:${port}/health/liveness`);
    expect(liveRes.status).toBe(200);
    const liveJson = (await liveRes.json()) as any;
    expect(liveJson.status).toBe('ok');

    const readyRes = await fetch(`http://127.0.0.1:${port}/health/readiness`);
    expect(readyRes.status).toBe(200);
    const readyJson = (await readyRes.json()) as any;
    expect(readyJson.status).toBe('ok');
  });

  it('registers and lists external MCP servers via HTTP', async () => {
    const registerRes = await fetch(`http://127.0.0.1:${port}/internal/v1/mcp/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'test-tenant',
      },
      body: JSON.stringify({
        name: 'Test Stdio Server',
        description: 'Local stdio testing',
        transportType: 'stdio',
        transportConfig: {
          type: 'stdio',
          config: { command: 'node' },
        },
      }),
    });

    expect(registerRes.status).toBe(201);
    const regJson = (await registerRes.json()) as any;
    expect(regJson.success).toBe(true);
    expect(regJson.data.server.name).toBe('Test Stdio Server');
    const serverId = regJson.data.server.serverId;

    // List servers
    const listRes = await fetch(`http://127.0.0.1:${port}/internal/v1/mcp/servers`, {
      headers: {
        'X-Tenant-ID': 'test-tenant',
      },
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as any;
    expect(listJson.data.servers).toHaveLength(1);
    expect(listJson.data.servers[0].serverId).toBe(serverId);

    // Get server
    const getRes = await fetch(`http://127.0.0.1:${port}/internal/v1/mcp/servers/${serverId}`, {
      headers: {
        'X-Tenant-ID': 'test-tenant',
      },
    });
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as any;
    expect(getJson.data.server.serverId).toBe(serverId);

    // Disconnect server
    const discRes = await fetch(
      `http://127.0.0.1:${port}/internal/v1/mcp/servers/${serverId}/disconnect`,
      {
        method: 'POST',
        headers: {
          'X-Tenant-ID': 'test-tenant',
        },
      },
    );
    expect(discRes.status).toBe(200);
  });
});
