import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiOrchestratorService } from '../../src/service.js';
import { loadAiOrchestratorConfig } from '../../src/config.js';
import type { MemoryCallContext } from '../../src/application/ports/memory.port.js';
import type { ModelRegistryPort } from '../../src/application/ports/model-registry.port.js';
import { createInternalServiceToken } from '../../src/infrastructure/security/internal-service-token.js';
import { FakeMemory } from '../test-doubles/fake-memory.js';

const INTERNAL_SECRET = 'resource-proxy-test-secret';

interface RecordedCall {
  readonly context: MemoryCallContext;
  readonly body?: unknown;
  readonly conversationId?: string;
}

/** Registry stub that records the context it receives and serves a canned catalog. */
class RecordingRegistry implements ModelRegistryPort {
  public catalogCalls: Array<{
    readonly tenantId: string;
    readonly correlationId: string;
  }> = [];

  public async getCatalog(
    context: { readonly tenantId: string; readonly correlationId: string },
    _signal?: AbortSignal,
  ): Promise<unknown> {
    this.catalogCalls.push({ tenantId: context.tenantId, correlationId: context.correlationId });
    return {
      models: [
        {
          id: 'oicunt.model.catalog-alpha',
          displayName: 'Catalog Model Alpha',
          status: 'available',
        },
      ],
    };
  }

  public async resolveModel(): Promise<never> {
    throw new Error('not used by resource proxy tests');
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }
}

/** Memory stub that records resource-call contexts for conversations/messages. */
class RecordingMemory extends FakeMemory {
  public resourceCalls: RecordedCall[] = [];

  public async createConversation(
    body: unknown,
    context: MemoryCallContext,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    this.resourceCalls.push({ context: { ...context }, body });
    return { id: 'conv_proxy_1', tenantId: context.tenantId };
  }

  public async listConversations(
    context: MemoryCallContext,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    this.resourceCalls.push({ context: { ...context } });
    return { conversations: [], total: 0, hasMore: false };
  }

  public async listMessages(
    conversationId: string,
    context: MemoryCallContext,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    this.resourceCalls.push({ context: { ...context }, conversationId });
    return { messages: [], hasMore: false };
  }
}

describe('HTTP Interfaces - Resource Proxy Signed Context', () => {
  let service: AiOrchestratorService;
  let registry: RecordingRegistry;
  let memory: RecordingMemory;
  let baseUrl: string;

  function signedHeaders(
    claims: {
      tenantId?: string;
      userId?: string;
      requestId?: string;
      correlationId?: string;
    },
    serviceName = 'billy-api',
  ): Record<string, string> {
    const token = createInternalServiceToken({
      serviceName,
      audience: 'ai-orchestrator',
      secret: INTERNAL_SECRET,
      ...claims,
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'X-Service-Name': serviceName,
    };
    if (claims.tenantId !== undefined) headers['X-Tenant-ID'] = claims.tenantId;
    if (claims.userId !== undefined) headers['X-User-ID'] = claims.userId;
    if (claims.requestId !== undefined) headers['X-Request-ID'] = claims.requestId;
    if (claims.correlationId !== undefined) headers['X-Correlation-ID'] = claims.correlationId;
    return headers;
  }

  beforeEach(async () => {
    registry = new RecordingRegistry();
    memory = new RecordingMemory();

    const config = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalToken: INTERNAL_SECRET,
      allowedServiceIdentities: ['billy-api', 'platform-api-gateway'],
    });

    service = new AiOrchestratorService({
      config,
      modelRegistry: registry,
      inference: {
        executeUnary: async () => {
          throw new Error('not used by resource proxy tests');
        },
        executeStream: async function* () {},
        checkHealth: async () => true,
      },
      memory,
    });

    const port = await service.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await service.stop();
  });

  it('forwards tenant and correlation context to the model catalog', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/catalog`, {
      headers: signedHeaders({ tenantId: 'tnt_proxy', correlationId: 'corr-proxy-1' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(registry.catalogCalls).toHaveLength(1);
    expect(registry.catalogCalls[0]?.tenantId).toBe('tnt_proxy');
    expect(registry.catalogCalls[0]?.correlationId).toBe('corr-proxy-1');
  });

  it('fails closed when the signed tenant claim does not match the header on catalog', async () => {
    const token = createInternalServiceToken({
      serviceName: 'billy-api',
      audience: 'ai-orchestrator',
      secret: INTERNAL_SECRET,
      tenantId: 'tnt_signed',
      correlationId: 'corr-proxy-mismatch',
    });

    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/catalog`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Service-Name': 'billy-api',
        'X-Tenant-ID': 'tnt_spoofed',
        'X-Correlation-ID': 'corr-proxy-mismatch',
      },
    });

    expect(res.status).toBe(403);
    expect(registry.catalogCalls).toHaveLength(0);
  });

  it('fails closed for catalog requests with no tenant context', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/catalog`, {
      headers: signedHeaders({ correlationId: 'corr-proxy-no-tenant' }),
    });

    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(registry.catalogCalls).toHaveLength(0);
  });

  it('forwards full tenant/user context on conversation creation', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signedHeaders({
          tenantId: 'tnt_proxy',
          userId: 'usr_proxy',
          requestId: 'req-proxy-1',
          correlationId: 'corr-proxy-2',
        }),
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    expect(memory.resourceCalls).toHaveLength(1);
    const forwarded = memory.resourceCalls[0]?.context;
    expect(forwarded?.tenantId).toBe('tnt_proxy');
    expect(forwarded?.userId).toBe('usr_proxy');
    expect(forwarded?.requestId).toBe('req-proxy-1');
    expect(forwarded?.correlationId).toBe('corr-proxy-2');
  });

  it('fails closed for conversation requests with no user context', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signedHeaders({ tenantId: 'tnt_proxy', correlationId: 'corr-proxy-no-user' }),
      },
      body: JSON.stringify({}),
    });

    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(memory.resourceCalls).toHaveLength(0);
  });

  it('forwards tenant/user context on message listing', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/conversations/conv_123/messages`, {
      headers: signedHeaders({
        tenantId: 'tnt_proxy',
        userId: 'usr_proxy',
        correlationId: 'corr-proxy-3',
      }),
    });

    expect(res.status).toBe(200);
    expect(memory.resourceCalls).toHaveLength(1);
    expect(memory.resourceCalls[0]?.conversationId).toBe('conv_123');
    const forwarded = memory.resourceCalls[0]?.context;
    expect(forwarded?.tenantId).toBe('tnt_proxy');
    expect(forwarded?.userId).toBe('usr_proxy');
    expect(forwarded?.correlationId).toBe('corr-proxy-3');
  });

  it('rejects mismatched signed user context on resource requests', async () => {
    const token = createInternalServiceToken({
      serviceName: 'billy-api',
      audience: 'ai-orchestrator',
      secret: INTERNAL_SECRET,
      tenantId: 'tnt_proxy',
      userId: 'usr_signed',
      correlationId: 'corr-proxy-user-mismatch',
    });

    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/conversations/conv_123/messages`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Service-Name': 'billy-api',
        'X-Tenant-ID': 'tnt_proxy',
        'X-User-ID': 'usr_spoofed',
        'X-Correlation-ID': 'corr-proxy-user-mismatch',
      },
    });

    expect(res.status).toBe(403);
    expect(memory.resourceCalls).toHaveLength(0);
  });

  it('rejects spoofed service identity on resource requests', async () => {
    const token = createInternalServiceToken({
      serviceName: 'billy-api',
      audience: 'ai-orchestrator',
      secret: INTERNAL_SECRET,
      tenantId: 'tnt_proxy',
      correlationId: 'corr-proxy-spoof',
    });

    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/catalog`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Service-Name': 'evil-service',
        'X-Tenant-ID': 'tnt_proxy',
        'X-Correlation-ID': 'corr-proxy-spoof',
      },
    });

    expect(res.status).toBe(403);
    expect(registry.catalogCalls).toHaveLength(0);
  });

  it('rejects resource requests without a token', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/orchestrator/catalog`, {
      headers: { 'X-Service-Name': 'billy-api' },
    });

    expect(res.status).toBe(401);
    expect(registry.catalogCalls).toHaveLength(0);
  });
});
