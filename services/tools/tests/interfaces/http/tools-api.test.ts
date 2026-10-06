import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolsService } from '../../../src/service.js';
import { loadToolsConfig } from '../../../src/config.js';
import type { ToolDefinition } from '../../../src/domain/index.js';

describe('Tools HTTP API Integration', () => {
  let service: ToolsService;
  let baseUrl: string;
  const internalToken = 'test-internal-token-tools-api';

  beforeAll(async () => {
    const config = loadToolsConfig({
      port: 0,
      host: '127.0.0.1',
      internalToken,
      useDatabase: false,
      logLevel: 'silent',
    });

    service = new ToolsService({ config });
    await service.start();

    const address = service.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await service.stop();
  });

  const headers = {
    Authorization: `Bearer ${internalToken}`,
    'X-Tenant-ID': 'tenant_http_test',
    'X-User-ID': 'user_http_test',
    'X-Actor-ID': 'actor_http_test',
    'X-Correlation-ID': 'corr_http_test',
    'Content-Type': 'application/json',
  };

  it('responds 200 to health check probes without authentication', async () => {
    const liveRes = await fetch(`${baseUrl}/health/liveness`);
    expect(liveRes.status).toBe(200);
    const liveJson = (await liveRes.json()) as { status: string };
    expect(liveJson.status).toBe('ok');

    const readyRes = await fetch(`${baseUrl}/health/readiness`);
    expect(readyRes.status).toBe(200);

    const healthz = await fetch(`${baseUrl}/healthz`);
    expect(healthz.status).toBe(200);
  });

  it('rejects protected internal API requests without valid bearer token', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/tools`, {
      headers: {
        'X-Tenant-ID': 'tenant_http_test',
      },
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rejects requests missing mandatory X-Tenant-ID header', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/tools`, {
      headers: {
        Authorization: `Bearer ${internalToken}`,
      },
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_TOOL_ARGUMENTS');
  });

  it('lists registered tools via GET /internal/v1/tools', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/tools`, { headers });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { tools: unknown[] };
      meta: { correlationId: string; requestId: string };
    };
    expect(json.success).toBe(true);
    expect(json.data.tools.length).toBeGreaterThanOrEqual(4);
    expect(json.meta.correlationId).toBe('corr_http_test');
  });

  it('registers a custom tool via POST /internal/v1/tools/register', async () => {
    const customTool: ToolDefinition = {
      toolId: 'oicunt.tool.custom.reverse_string',
      displayName: 'Reverse String',
      description: 'Reverses a string value',
      version: '1.0.0',
      category: 'custom',
      source: 'internal',
      capabilities: {
        isReadOnly: true,
        hasSideEffects: false,
        requiresConfirmation: false,
        networkEgress: false,
        accessesSensitiveData: false,
      },
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
      timeoutPolicy: { defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
      status: 'active',
      tags: ['custom'],
    };

    const res = await fetch(`${baseUrl}/internal/v1/tools/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(customTool),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { success: boolean; data: { registered: boolean } };
    expect(json.success).toBe(true);
    expect(json.data.registered).toBe(true);

    // Fetch registered tool
    const getRes = await fetch(
      `${baseUrl}/internal/v1/tools/${encodeURIComponent(customTool.toolId)}`,
      { headers },
    );
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as { data: ToolDefinition };
    expect(getJson.data.toolId).toBe(customTool.toolId);
  });

  it('synchronously executes a tool via POST /internal/v1/tools/execute', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/tools/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        callId: 'call_http_exec_1',
        toolId: 'oicunt.tool.computation.evaluate',
        arguments: { expression: '12 * 12' },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: {
        status: string;
        output: { result: number };
        execution: { durationMs: number; isReadOnly: boolean };
      };
    };
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('success');
    expect(json.data.output.result).toBe(144);
    expect(json.data.execution.isReadOnly).toBe(true);
  });

  it('runs asynchronous execution, checks status, and cancels job', async () => {
    // 1. Dispatch async execution
    const postRes = await fetch(`${baseUrl}/internal/v1/tools/execute-async`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        callId: 'call_http_async',
        toolId: 'oicunt.tool.computation.evaluate',
        arguments: { expression: '50 + 50' },
      }),
    });

    expect(postRes.status).toBe(202);
    const postJson = (await postRes.json()) as {
      success: boolean;
      data: { executionId: string; status: string };
    };
    expect(postJson.success).toBe(true);
    const executionId = postJson.data.executionId;
    expect(executionId).toBeDefined();

    // 2. Poll status
    await new Promise((resolve) => setTimeout(resolve, 50));
    const statusRes = await fetch(`${baseUrl}/internal/v1/tools/executions/${executionId}`, {
      headers,
    });
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as {
      success: boolean;
      data: { status: string; result?: { output: { result: number } } };
    };
    expect(statusJson.success).toBe(true);
    expect(statusJson.data.status).toBe('completed');
    expect(statusJson.data.result?.output.result).toBe(100);

    // 3. Test cancel endpoint on fresh job
    const freshJobRes = await fetch(`${baseUrl}/internal/v1/tools/execute-async`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        callId: 'call_cancel_test',
        toolId: 'oicunt.tool.computation.evaluate',
        arguments: { expression: '1 + 1' },
      }),
    });
    const freshJobJson = (await freshJobRes.json()) as { data: { executionId: string } };

    const cancelRes = await fetch(
      `${baseUrl}/internal/v1/tools/executions/${freshJobJson.data.executionId}/cancel`,
      { method: 'POST', headers },
    );
    expect(cancelRes.status).toBe(200);
    const cancelJson = (await cancelRes.json()) as { data: { status: string } };
    expect(cancelJson.data.status).toBe('cancelled');
  });
});
