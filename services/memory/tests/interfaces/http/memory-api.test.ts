import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Conversation, PurgeResult } from '../../../src/domain/index.js';
import type { AppendMessagesResponseDto } from '../../../src/application/dtos/message.dto.js';
import type { ContextRetrievalDataDto } from '../../../src/application/dtos/context.dto.js';
import { MemoryService } from '../../../src/service.js';
import { loadMemoryConfig } from '../../../src/config.js';
import { InMemoryConversationRepository } from '../../../src/infrastructure/repositories/in-memory-conversation.repository.js';

interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: {
    readonly requestId?: string;
    readonly correlationId?: string;
    readonly timestamp?: string;
  };
}

interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

describe('HTTP Interfaces - Memory Service API', () => {
  let service: MemoryService;
  let repository: InMemoryConversationRepository;
  let baseUrl: string;
  const internalToken = 'test-memory-internal-token';

  beforeEach(async () => {
    repository = new InMemoryConversationRepository();
    const config = loadMemoryConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalToken,
      allowedServiceIdentities: ['ai-orchestrator', 'billy-api', 'ai-platform-admin'],
    });

    service = new MemoryService({
      config,
      repository,
    });

    const port = await service.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await service.stop();
  });

  const authHeaders = (caller = 'ai-orchestrator', tenant = 'tenant-123') => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${internalToken}`,
    'X-Service-Name': caller,
    'X-Tenant-Id': tenant,
    'X-User-Id': 'user-123',
    'X-Correlation-Id': 'corr-test-123',
    'X-Request-Id': 'req-test-123',
  });

  describe('Health Probes', () => {
    it('returns 200 for liveness probe (/healthz)', async () => {
      const res = await fetch(`${baseUrl}/healthz`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string };
      expect(data).toEqual({ status: 'alive' });
    });

    it('returns 200 for readiness probe (/readyz)', async () => {
      const res = await fetch(`${baseUrl}/readyz`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; database: string };
      expect(data).toEqual({ status: 'ready', database: 'connected' });
    });
  });

  describe('Authentication & Authorization & Context Extraction', () => {
    it('returns 401 when Authorization header is missing or invalid', async () => {
      const res1 = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Name': 'ai-orchestrator',
          'X-Tenant-Id': 'tenant-123',
          'X-User-Id': 'user-123',
        },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res1.status).toBe(401);

      const res2 = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-secret',
          'X-Service-Name': 'ai-orchestrator',
          'X-Tenant-Id': 'tenant-123',
          'X-User-Id': 'user-123',
        },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res2.status).toBe(401);
    });

    it('returns 403 when X-Service-Name is not in the whitelist', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${internalToken}`,
          'X-Service-Name': 'untrusted-service',
          'X-Tenant-Id': 'tenant-123',
          'X-User-Id': 'user-123',
        },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 when X-Tenant-Id is missing', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${internalToken}`,
          'X-Service-Name': 'ai-orchestrator',
          'X-User-Id': 'user-123',
        },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 504 when deadline has already expired', async () => {
      const pastDeadline = Date.now() - 5000;
      const res = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'X-Deadline-Ms': String(pastDeadline),
        },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(504);
      const json = (await res.json()) as ApiErrorResponse;
      expect(json.error.code).toBe('STORAGE_TIMEOUT');
    });
  });

  describe('Conversation Lifecycle Endpoints', () => {
    it('creates, retrieves, updates, and lists conversations', async () => {
      // 1. Create
      const createRes = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          title: 'My Project Discussion',
          metadata: { project: 'oicunt' },
        }),
      });
      expect(createRes.status).toBe(201);
      const createBody = (await createRes.json()) as ApiSuccessResponse<Conversation>;
      expect(createBody.success).toBe(true);
      expect(createBody.data.title).toBe('My Project Discussion');
      expect(createBody.data.tenantId).toBe('tenant-123');
      expect(createBody.data.id).toMatch(/^conv_/);
      const convId = createBody.data.id;

      // 2. Get by ID
      const getRes = await fetch(`${baseUrl}/internal/v1/memory/conversations/${convId}`, {
        headers: authHeaders(),
      });
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as ApiSuccessResponse<Conversation>;
      expect(getBody.data.id).toBe(convId);
      expect(getBody.data.metadata['project']).toBe('oicunt');

      // 3. Update
      const patchRes = await fetch(`${baseUrl}/internal/v1/memory/conversations/${convId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          title: 'Updated Project Discussion',
          status: 'archived',
        }),
      });
      expect(patchRes.status).toBe(200);
      const patchBody = (await patchRes.json()) as ApiSuccessResponse<Conversation>;
      expect(patchBody.data.title).toBe('Updated Project Discussion');
      expect(patchBody.data.status).toBe('archived');

      // 4. List conversations
      const listRes = await fetch(
        `${baseUrl}/internal/v1/memory/conversations?status=all&limit=10`,
        {
          headers: authHeaders(),
        },
      );
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as ApiSuccessResponse<{
        readonly conversations: readonly Conversation[];
        readonly total: number;
        readonly hasMore: boolean;
      }>;
      expect(listBody.data.conversations.length).toBe(1);
      expect(listBody.data.conversations[0]?.id).toBe(convId);
    });

    it('soft deletes conversation returning 410 on subsequent get, and hard purges returning 404', async () => {
      // Create
      const createRes = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title: 'To Delete' }),
      });
      const convId = ((await createRes.json()) as ApiSuccessResponse<Conversation>).data.id;

      // Soft delete
      const delRes = await fetch(`${baseUrl}/internal/v1/memory/conversations/${convId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(delRes.status).toBe(200);
      const delBody = (await delRes.json()) as ApiSuccessResponse<{
        readonly deleted: boolean;
        readonly hard: boolean;
        readonly conversationId: string;
      }>;
      expect(delBody.data.deleted).toBe(true);
      expect(delBody.data.hard).toBe(false);

      // Subsequent GET returns 410 Gone
      const getRes410 = await fetch(`${baseUrl}/internal/v1/memory/conversations/${convId}`, {
        headers: authHeaders(),
      });
      expect(getRes410.status).toBe(410);

      // Hard delete
      const hardDelRes = await fetch(
        `${baseUrl}/internal/v1/memory/conversations/${convId}?hard=true`,
        {
          method: 'DELETE',
          headers: authHeaders(),
        },
      );
      expect(hardDelRes.status).toBe(200);
      const hardDelBody = (await hardDelRes.json()) as ApiSuccessResponse<{
        readonly deleted: boolean;
        readonly hard: boolean;
        readonly conversationId: string;
      }>;
      expect(hardDelBody.data.deleted).toBe(true);
      expect(hardDelBody.data.hard).toBe(true);

      // Subsequent GET returns 404 Not Found
      const getRes404 = await fetch(`${baseUrl}/internal/v1/memory/conversations/${convId}`, {
        headers: authHeaders(),
      });
      expect(getRes404.status).toBe(404);
    });
  });

  describe('Message Sequencing and Listing Endpoints', () => {
    it('appends messages and lists them with pagination', async () => {
      const createRes = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title: 'Chat' }),
      });
      const convId = ((await createRes.json()) as ApiSuccessResponse<Conversation>).data.id;

      // Append messages
      const appendRes = await fetch(
        `${baseUrl}/internal/v1/memory/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            turnId: 'turn-1',
            messages: [
              { role: 'user', content: 'Hello!' },
              { role: 'assistant', content: 'Hi there!' },
            ],
          }),
        },
      );
      expect(appendRes.status).toBe(201);
      const appendBody = (await appendRes.json()) as ApiSuccessResponse<AppendMessagesResponseDto>;
      expect(appendBody.data.appendedCount).toBe(2);
      expect(appendBody.data.messages[0]?.sequenceNumber).toBe(1);
      expect(appendBody.data.messages[1]?.sequenceNumber).toBe(2);

      // List messages with limit 1
      const listRes1 = await fetch(
        `${baseUrl}/internal/v1/memory/conversations/${convId}/messages?limit=1`,
        {
          headers: authHeaders(),
        },
      );
      expect(listRes1.status).toBe(200);
      const listBody1 = (await listRes1.json()) as ApiSuccessResponse<{
        readonly messages: readonly { readonly sequenceNumber: number }[];
        readonly hasMore: boolean;
      }>;
      expect(listBody1.data.messages.length).toBe(1);
      expect(listBody1.data.hasMore).toBe(true);
      expect(listBody1.data.messages[0]?.sequenceNumber).toBe(1);

      // List messages next page
      const listRes2 = await fetch(
        `${baseUrl}/internal/v1/memory/conversations/${convId}/messages?afterSequence=1&limit=1`,
        {
          headers: authHeaders(),
        },
      );
      expect(listRes2.status).toBe(200);
      const listBody2 = (await listRes2.json()) as ApiSuccessResponse<{
        readonly messages: readonly { readonly sequenceNumber: number }[];
        readonly hasMore: boolean;
      }>;
      expect(listBody2.data.messages.length).toBe(1);
      expect(listBody2.data.messages[0]?.sequenceNumber).toBe(2);
      expect(listBody2.data.hasMore).toBe(false);
    });
  });

  describe('Bounded Context Retrieval Endpoint', () => {
    it('retrieves sliding-window bounded context for orchestrator', async () => {
      const createRes = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title: 'Context Chat' }),
      });
      const convId = ((await createRes.json()) as ApiSuccessResponse<Conversation>).data.id;

      // Append 4 messages
      await fetch(`${baseUrl}/internal/v1/memory/conversations/${convId}/messages`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          turnId: 'turn-1',
          messages: [
            { role: 'user', content: 'Turn 1 user' },
            { role: 'assistant', content: 'Turn 1 assistant' },
            { role: 'user', content: 'Turn 2 user' },
            { role: 'assistant', content: 'Turn 2 assistant' },
          ],
        }),
      });

      // Request context with maxMessages: 2
      const contextRes = await fetch(
        `${baseUrl}/internal/v1/memory/conversations/${convId}/context`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            maxMessages: 2,
          }),
        },
      );

      expect(contextRes.status).toBe(200);
      const contextBody = (await contextRes.json()) as ApiSuccessResponse<ContextRetrievalDataDto>;
      expect(contextBody.success).toBe(true);
      expect(contextBody.data.conversationId).toBe(convId);
      expect(contextBody.data.messages.length).toBe(2);
      expect(contextBody.data.hasMore).toBe(true);
      expect(contextBody.data.messages[0]?.content).toBe('Turn 2 user');
      expect(contextBody.data.messages[1]?.content).toBe('Turn 2 assistant');
      expect(contextBody.data.earliestSequenceNumber).toBe(3);
      expect(contextBody.data.latestSequenceNumber).toBe(4);
    });
  });

  describe('Purge Endpoint', () => {
    it('forbids non-admin services from calling purge', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/memory/tenants/tenant-123/purge`, {
        method: 'POST',
        headers: authHeaders('ai-orchestrator'),
        body: JSON.stringify({
          reason: 'Test purge',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('allows ai-platform-admin to execute purge', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/memory/tenants/tenant-123/purge`, {
        method: 'POST',
        headers: authHeaders('ai-platform-admin'),
        body: JSON.stringify({
          reason: 'GDPR deletion',
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiSuccessResponse<PurgeResult>;
      expect(body.success).toBe(true);
      expect(body.data.tenantId).toBe('tenant-123');
    });
  });

  describe('Routing Fallbacks', () => {
    it('returns 404 for unrecognized routes', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/memory/nonexistent`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });

    it('returns 405 for unsupported HTTP methods on matched routes', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/memory/conversations`, {
        method: 'PUT',
        headers: authHeaders(),
      });
      expect(res.status).toBe(405);
    });
  });
});
