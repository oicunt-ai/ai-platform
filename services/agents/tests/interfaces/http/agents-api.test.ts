import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentsService } from '../../../src/service.js';
import { loadAgentsConfig } from '../../../src/config.js';
import type {
  AgentInferenceRequest,
  AgentInferenceResponse,
  InferenceClientPort,
} from '../../../src/application/ports/inference-client.port.js';
import type {
  AgentToolExecutionOutcome,
  AgentToolExecutionRequest,
  ToolsClientPort,
} from '../../../src/application/ports/tools-client.port.js';

class MockInferenceClient implements InferenceClientPort {
  public async execute(
    _request: AgentInferenceRequest,
    _signal?: AbortSignal,
  ): Promise<AgentInferenceResponse> {
    return {
      completionId: 'comp_http_test_1',
      message: { role: 'assistant', content: 'HTTP API test completed successfully.' },
      finishReason: 'stop',
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    };
  }
}

class MockToolsClient implements ToolsClientPort {
  public async executeTool(
    _request: AgentToolExecutionRequest,
    _signal?: AbortSignal,
  ): Promise<AgentToolExecutionOutcome> {
    return {
      status: 'success',
      output: { ok: true },
      durationMs: 10,
    };
  }
}

describe('Agents HTTP API Integration', () => {
  let service: AgentsService;
  let baseUrl: string;
  const internalToken = 'test-internal-token-agents-api';

  beforeAll(async () => {
    const config = loadAgentsConfig({
      port: 0,
      host: '127.0.0.1',
      internalToken,
      useDatabase: false,
      logLevel: 'silent',
    });

    service = new AgentsService({
      config,
      inferenceClient: new MockInferenceClient(),
      toolsClient: new MockToolsClient(),
    });
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

  it('responds 200 to health probes without auth', async () => {
    const liveRes = await fetch(`${baseUrl}/health/liveness`);
    expect(liveRes.status).toBe(200);
    const liveJson = (await liveRes.json()) as { status: string };
    expect(liveJson.status).toBe('ok');

    const readyRes = await fetch(`${baseUrl}/health/readiness`);
    expect(readyRes.status).toBe(200);
  });

  it('rejects protected routes without valid token', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/agents`, {
      headers: {
        'X-Tenant-ID': 'tenant_http_test',
      },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('PERMISSION_DENIED');
  });

  it('rejects requests missing mandatory X-Tenant-ID header', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/agents`, {
      headers: {
        Authorization: `Bearer ${internalToken}`,
      },
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_REQUEST');
  });

  it('lists agents catalog via GET /internal/v1/agents', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/agents`, { headers });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean; data: any[] };
    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(3);
  });

  it('gets a specific agent via GET /internal/v1/agents/:agentId', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/agents/oicunt.agent.general`, { headers });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean; data: { agent: any; version: any } };
    expect(json.success).toBe(true);
    expect(json.data.agent.agentId).toBe('oicunt.agent.general');
    expect(json.data.version.version).toBe('1.0.0');
  });

  it('executes a synchronous run via POST /internal/v1/agents/runs', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/agents/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agentId: 'oicunt.agent.general',
        input: 'Draft quarterly report summary',
        mode: 'sync',
      }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      success: boolean;
      data: {
        runId: string;
        status: string;
        finalOutput: string;
        totalSteps: number;
      };
    };

    expect(json.success).toBe(true);
    expect(json.data.status).toBe('completed');
    expect(json.data.finalOutput).toBe('HTTP API test completed successfully.');
    expect(json.data.totalSteps).toBe(1);

    const runId = json.data.runId;

    // Get run details
    const runRes = await fetch(`${baseUrl}/internal/v1/agents/runs/${runId}`, { headers });
    expect(runRes.status).toBe(200);
    const runJson = (await runRes.json()) as { data: { status: string; steps: any[] } };
    expect(runJson.data.status).toBe('completed');
    expect(runJson.data.steps.length).toBe(1);

    // Get step history
    const stepsRes = await fetch(`${baseUrl}/internal/v1/agents/runs/${runId}/steps`, { headers });
    expect(stepsRes.status).toBe(200);
    const stepsJson = (await stepsRes.json()) as { data: any[] };
    expect(stepsJson.data.length).toBe(1);
  });

  it('enqueues an async run returning 202 via POST /internal/v1/agents/runs', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/agents/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agentId: 'oicunt.agent.general',
        input: 'Async deep research',
        mode: 'async',
      }),
    });

    expect(res.status).toBe(202);
    const json = (await res.json()) as {
      success: boolean;
      data: {
        runId: string;
        status: string;
      };
    };

    expect(json.success).toBe(true);
    expect(json.data.status).toBe('pending');
  });

  it('streams run execution events via SSE when stream: true', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/agents/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agentId: 'oicunt.agent.general',
        input: 'Stream this run',
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const bodyText = await res.text();
    expect(bodyText).toContain('event: run_started');
    expect(bodyText).toContain('event: run_completed');
  });
});
