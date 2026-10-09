import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpMemoryClient } from '../../src/infrastructure/clients/http-memory.client.js';
import type { MemoryCallContext } from '../../src/application/ports/memory.port.js';
import {
  AuthenticationError,
  ForbiddenError,
  InferenceTimeoutError,
  InvalidRequestError,
  OrchestratorError,
  RequestCancelledError,
} from '../../src/domain/errors.js';

describe('Infrastructure - HttpMemoryClient', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  } | null = null;
  let responseStatus = 200;
  let responseBody: unknown = { success: true };

  const testContext: MemoryCallContext = {
    tenantId: 'tenant-abc',
    userId: 'user-123',
    actorId: 'actor-456',
    turnId: 'turn-789',
    correlationId: 'corr-xyz',
    requestId: 'req-001',
    deadlineMs: 1700000000000,
  };

  beforeEach(async () => {
    lastRequest = null;
    responseStatus = 200;
    responseBody = { success: true };

    server = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        let parsedBody: unknown;
        try {
          parsedBody = data ? JSON.parse(data) : null;
        } catch {
          parsedBody = data;
        }
        lastRequest = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: parsedBody,
        };

        res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseBody));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('retrieves conversation context and propagates all identity headers', async () => {
    const mockContextData = {
      conversationId: 'conv-100',
      messages: [{ role: 'user', content: 'hello' }],
      summary: null,
      estimatedTokens: 15,
      hasMore: false,
      totalStoredMessages: 1,
      returnedMessages: 1,
      earliestSequenceNumber: 1,
      latestSequenceNumber: 1,
    };
    responseBody = { success: true, data: mockContextData };

    const client = new HttpMemoryClient({ baseUrl, internalToken: 'test-token' });
    const result = await client.getContext('conv-100', { maxTokens: 4000 }, testContext);

    expect(result).toEqual(mockContextData);
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.url).toBe('/internal/v1/memory/conversations/conv-100/context');
    expect(lastRequest?.headers['x-service-name']).toBe('ai-orchestrator');
    expect(lastRequest?.headers['x-request-id']).toBe('req-001');
    expect(lastRequest?.headers['x-turn-id']).toBe('turn-789');
    expect(lastRequest?.headers['x-correlation-id']).toBe('corr-xyz');
    expect(lastRequest?.headers['x-tenant-id']).toBe('tenant-abc');
    expect(lastRequest?.headers['x-user-id']).toBe('user-123');
    expect(lastRequest?.headers['x-actor-id']).toBe('actor-456');
    expect(lastRequest?.headers['x-deadline-ms']).toBe('1700000000000');
    expect(lastRequest?.headers['authorization']).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(lastRequest?.body).toEqual({ maxTokens: 4000 });
  });

  it('checkpoints a conversation turn with messages and turnId', async () => {
    const client = new HttpMemoryClient({ baseUrl, internalToken: 'test-token' });
    await client.checkpointTurn(
      {
        conversationId: 'conv-100',
        turnId: 'turn-789',
        messages: [
          { role: 'user', content: 'What is OICUNT?' },
          { role: 'assistant', content: 'OICUNT is a platform.' },
        ],
      },
      testContext,
    );

    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.url).toBe('/internal/v1/memory/conversations/conv-100/messages');
    expect(lastRequest?.headers['x-turn-id']).toBe('turn-789');
    expect(lastRequest?.headers['x-request-id']).toBe('req-001');
    expect(lastRequest?.body).toEqual({
      turnId: 'turn-789',
      messages: [
        { role: 'user', content: 'What is OICUNT?' },
        { role: 'assistant', content: 'OICUNT is a platform.' },
      ],
    });
  });

  it('maps 400/404/410 errors into InvalidRequestError', async () => {
    responseStatus = 404;
    responseBody = {
      error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation conv-999 not found' },
    };

    const client = new HttpMemoryClient({ baseUrl });
    await expect(client.getContext('conv-999', {}, testContext)).rejects.toThrow(
      InvalidRequestError,
    );
  });

  it('maps 401 error into AuthenticationError', async () => {
    responseStatus = 401;
    responseBody = {
      error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' },
    };

    const client = new HttpMemoryClient({ baseUrl });
    await expect(client.getContext('conv-100', {}, testContext)).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('maps 403 error into ForbiddenError', async () => {
    responseStatus = 403;
    responseBody = {
      error: { code: 'FORBIDDEN', message: 'Forbidden access to tenant' },
    };

    const client = new HttpMemoryClient({ baseUrl });
    await expect(client.getContext('conv-100', {}, testContext)).rejects.toThrow(ForbiddenError);
  });

  it('maps 504 and STORAGE_TIMEOUT into InferenceTimeoutError', async () => {
    responseStatus = 504;
    responseBody = {
      error: { code: 'STORAGE_TIMEOUT', message: 'Database query timed out' },
    };

    const client = new HttpMemoryClient({ baseUrl });
    await expect(client.getContext('conv-100', {}, testContext)).rejects.toThrow(
      InferenceTimeoutError,
    );
  });

  it('maps 500 error into OrchestratorError without blind write retry', async () => {
    responseStatus = 500;
    responseBody = {
      error: { code: 'STORAGE_ERROR', message: 'Database connection failed' },
    };

    const client = new HttpMemoryClient({ baseUrl });
    await expect(
      client.checkpointTurn(
        {
          conversationId: 'conv-100',
          turnId: 'turn-789',
          messages: [{ role: 'user', content: 'test' }],
        },
        testContext,
      ),
    ).rejects.toThrow(OrchestratorError);
  });

  it('maps aborted signal into RequestCancelledError', async () => {
    const controller = new AbortController();
    controller.abort();

    const client = new HttpMemoryClient({ baseUrl });
    await expect(client.getContext('conv-100', {}, testContext, controller.signal)).rejects.toThrow(
      RequestCancelledError,
    );
  });

  it('probes readiness correctly via checkHealth', async () => {
    const client = new HttpMemoryClient({ baseUrl });

    responseStatus = 200;
    expect(await client.checkHealth()).toBe(true);
    expect(lastRequest?.url).toBe('/health/readiness');

    responseStatus = 503;
    expect(await client.checkHealth()).toBe(false);
  });
});
