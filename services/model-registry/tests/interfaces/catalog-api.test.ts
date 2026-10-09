import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryAuditRepository } from '../../src/infrastructure/repositories/in-memory-audit.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import { ModelRegistryService } from '../../src/service.js';

describe('HTTP Catalog API Integration & Authorization', () => {
  let service: ModelRegistryService;
  let modelRepo: InMemoryModelRepository;
  let auditRepo: InMemoryAuditRepository;
  let cache: InMemoryModelCache;
  let port: number;

  beforeAll(async () => {
    modelRepo = new InMemoryModelRepository();
    auditRepo = new InMemoryAuditRepository();
    cache = new InMemoryModelCache();

    service = new ModelRegistryService({
      modelRepository: modelRepo,
      auditRepository: auditRepo,
      cache,
      config: {
        serviceName: 'model-registry',
        environment: 'test',
        port: 0,
        host: '127.0.0.1',
        version: '0.1.0',
        shutdownTimeoutMs: 1000,
        enableTelemetry: false,
        logLevel: 'silent',
        database: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'postgres',
          ssl: false,
          maxConnections: 1,
          idleTimeoutMs: 1000,
          connectionTimeoutMs: 1000,
        },
        cache: {
          enabled: false,
          defaultTtlSeconds: 60,
          staleTtlSeconds: 300,
        },
        allowedServiceIdentities: ['ai-orchestrator', 'model-gateway', 'ai-platform-admin'],
        maxBodySizeBytes: 10000, // 10KB limit for test
      },
    });

    port = await service.start();
  });

  afterAll(async () => {
    await service.stop();
  });

  it('rejects requests without X-Service-Name with 401 UNAUTHORIZED', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models`, {
      method: 'GET',
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(json.error.message).toContain('X-Service-Name');
  });

  it('rejects requests from unallowed service identities with 403 FORBIDDEN', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models`, {
      method: 'GET',
      headers: {
        'x-service-name': 'unauthorized-external-service',
      },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.error.message).toContain('not permitted');
  });

  it('rejects administrative mutations from non-admin service identities with 403 FORBIDDEN', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-name': 'ai-orchestrator', // read/resolve only, cannot mutate
        'x-actor-id': 'some-user',
      },
      body: JSON.stringify({
        id: 'oicunt.model.forbidden',
        displayName: 'Forbidden',
        description: 'Desc',
        activeVersion: 'v1.0.0',
      }),
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.error.message).toContain('not authorized for administrative catalog mutations');
  });

  it('rejects POST /internal/v1/models without X-Actor-ID header with 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-name': 'ai-platform-admin',
      },
      body: JSON.stringify({
        id: 'oicunt.model.catalog-alpha',
        displayName: 'General',
        description: 'Desc',
        activeVersion: 'v1.0.0',
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_FAILED');
    expect(json.error.message).toContain('X-Actor-ID');
  });

  it('creates canonical model via POST /internal/v1/models and lists it via GET', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-name': 'ai-platform-admin',
        'x-actor-id': 'admin-tester',
        'x-change-reason': 'Adding general model',
      },
      body: JSON.stringify({
        id: 'oicunt.model.catalog-alpha',
        displayName: 'General Intelligence',
        description: 'Conversational model',
        activeVersion: 'v1.0.0',
      }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe('oicunt.model.catalog-alpha');

    const listRes = await fetch(`http://127.0.0.1:${port}/internal/v1/models`, {
      headers: {
        'x-service-name': 'ai-orchestrator',
      },
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data).toHaveLength(1);
    expect(listJson.data[0]?.id).toBe('oicunt.model.catalog-alpha');
  });

  it('publishes model version via POST /internal/v1/models/:id/versions', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/oicunt.model.catalog-alpha/versions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-name': 'ai-platform-admin',
          'x-actor-id': 'admin-tester',
        },
        body: JSON.stringify({
          version: 'v1.0.0',
          modalities: ['text'],
          capabilities: {
            streaming: true,
            toolCalling: true,
            structuredOutputs: true,
            reasoning: false,
            vision: false,
            audioInput: false,
            audioOutput: false,
            systemInstructions: true,
          },
          limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
          pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
        }),
      },
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { version: string; isImmutable: boolean } };
    expect(json.data.version).toBe('v1.0.0');
    expect(json.data.isImmutable).toBe(true);
  });

  it('enforces mandatory X-Change-Reason on status mutations', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/oicunt.model.catalog-alpha/versions/v1.0.0/status`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-service-name': 'ai-platform-admin',
          'x-actor-id': 'admin-tester',
          // Omitting x-change-reason
        },
        body: JSON.stringify({
          status: 'maintenance',
        }),
      },
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_FAILED');
    expect(json.error.message).toContain('X-Change-Reason');
  });

  it('creates model target and updates target status with change reason', async () => {
    const model = (await modelRepo.findById('oicunt.model.catalog-alpha'))!;
    const versionId = model.getVersion('v1.0.0')!.id;

    // Create target
    const createRes = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/oicunt.model.catalog-alpha/targets`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-name': 'ai-platform-admin',
          'x-actor-id': 'admin-tester',
        },
        body: JSON.stringify({
          id: 'target-provider-a-1',
          modelVersionId: versionId,
          provider: 'test-provider',
          upstreamModelId: 'provider-model-alpha',
          priority: 1,
          weight: 100,
        }),
      },
    );

    expect(createRes.status).toBe(201);

    // Update target status (cordoning) with required X-Change-Reason
    const updateRes = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/oicunt.model.catalog-alpha/targets/target-provider-a-1/status`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-service-name': 'ai-platform-admin',
          'x-actor-id': 'ops-admin',
          'x-change-reason': 'Cordoning target for vendor maintenance',
        },
        body: JSON.stringify({
          status: 'maintenance',
        }),
      },
    );

    expect(updateRes.status).toBe(200);
    const updateJson = (await updateRes.json()) as { data: { status: string } };
    expect(updateJson.data.status).toBe('maintenance');
  });

  it('updates routing policy via PUT /internal/v1/models/:id/routing-policy', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/oicunt.model.catalog-alpha/routing-policy`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-service-name': 'ai-platform-admin',
          'x-actor-id': 'admin-tester',
        },
        body: JSON.stringify({
          strategy: 'weighted-round-robin',
          maxFallbackAttempts: 4,
          degradationBehavior: 'fallback-to-fast',
        }),
      },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { strategy: string; maxFallbackAttempts: number };
    };
    expect(json.data.strategy).toBe('weighted-round-robin');
    expect(json.data.maxFallbackAttempts).toBe(4);
  });

  it('sets alias via PUT /internal/v1/models/:id/aliases', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/oicunt.model.catalog-alpha/aliases`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-service-name': 'ai-platform-admin',
          'x-actor-id': 'admin-tester',
        },
        body: JSON.stringify({
          aliasName: 'latest',
          targetVersion: 'v1.0.0',
        }),
      },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { aliasName: string; targetVersion: string };
    };
    expect(json.data.aliasName).toBe('latest');
    expect(json.data.targetVersion).toBe('v1.0.0');
  });

  it('GET /internal/v1/models/:id retrieves full canonical model detail', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/oicunt.model.catalog-alpha`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        id: string;
        versions: unknown[];
        targets: unknown[];
        aliases: unknown[];
      };
    };
    expect(json.data.id).toBe('oicunt.model.catalog-alpha');
    expect(json.data.versions).toHaveLength(1);
    expect(json.data.targets).toHaveLength(1);
    expect(json.data.aliases).toHaveLength(1);
  });

  it('rejects oversized JSON bodies with 413 PAYLOAD_TOO_LARGE', async () => {
    // Configured maxBodySizeBytes is 10000 bytes
    const hugeString = 'a'.repeat(15000);
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-name': 'ai-platform-admin',
        'x-actor-id': 'admin-tester',
      },
      body: JSON.stringify({
        id: 'oicunt.model.catalog-alpha',
        displayName: hugeString,
        description: 'Huge payload',
        activeVersion: 'v1.0.0',
      }),
    });

    expect(res.status).toBe(413);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(json.error.message).toContain('maximum allowed size');
  });

  it('validates configured internalAuthToken and rejects invalid tokens with 401', async () => {
    // Start separate service instance with internalAuthToken configured
    const tokenService = new ModelRegistryService({
      modelRepository: modelRepo,
      auditRepository: auditRepo,
      cache,
      config: {
        serviceName: 'model-registry',
        environment: 'test',
        port: 0,
        host: '127.0.0.1',
        version: '0.1.0',
        shutdownTimeoutMs: 1000,
        enableTelemetry: false,
        logLevel: 'silent',
        database: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'postgres',
          ssl: false,
          maxConnections: 1,
          idleTimeoutMs: 1000,
          connectionTimeoutMs: 1000,
        },
        cache: { enabled: false, defaultTtlSeconds: 60, staleTtlSeconds: 300 },
        allowedServiceIdentities: ['ai-orchestrator', 'model-gateway', 'ai-platform-admin'],
        internalAuthToken: 'secret-service-token-xyz',
        maxBodySizeBytes: 1048576,
      },
    });

    const tokenPort = await tokenService.start();

    try {
      // 1. Missing token
      const noTokenRes = await fetch(`http://127.0.0.1:${tokenPort}/internal/v1/models`, {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      });
      expect(noTokenRes.status).toBe(401);

      // 2. Invalid token
      const wrongTokenRes = await fetch(`http://127.0.0.1:${tokenPort}/internal/v1/models`, {
        headers: {
          'x-service-name': 'ai-orchestrator',
          authorization: 'Bearer wrong-token',
        },
      });
      expect(wrongTokenRes.status).toBe(401);

      // 3. Valid token
      const validTokenRes = await fetch(`http://127.0.0.1:${tokenPort}/internal/v1/models`, {
        headers: {
          'x-service-name': 'ai-orchestrator',
          authorization: 'Bearer secret-service-token-xyz',
        },
      });
      expect(validTokenRes.status).toBe(200);
    } finally {
      await tokenService.stop();
    }
  });

  it('sanitizes unexpected internal 500 errors without leaking internal exception details', async () => {
    // Force an internal error in repository findById
    const brokenRepo = new InMemoryModelRepository();
    brokenRepo.findById = async () => {
      throw new Error('FATAL: pg_hba.conf rejects connection to database table secrets_internal');
    };

    const brokenService = new ModelRegistryService({
      modelRepository: brokenRepo,
      auditRepository: auditRepo,
      cache,
      config: {
        serviceName: 'model-registry',
        environment: 'test',
        port: 0,
        host: '127.0.0.1',
        version: '0.1.0',
        shutdownTimeoutMs: 1000,
        enableTelemetry: false,
        logLevel: 'silent',
        database: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'postgres',
          ssl: false,
          maxConnections: 1,
          idleTimeoutMs: 1000,
          connectionTimeoutMs: 1000,
        },
        cache: { enabled: false, defaultTtlSeconds: 60, staleTtlSeconds: 300 },
        allowedServiceIdentities: ['ai-orchestrator', 'model-gateway', 'ai-platform-admin'],
        maxBodySizeBytes: 1048576,
      },
    });

    const brokenPort = await brokenService.start();

    try {
      const res = await fetch(
        `http://127.0.0.1:${brokenPort}/internal/v1/models/oicunt.model.catalog-alpha`,
        {
          headers: {
            'x-service-name': 'ai-orchestrator',
          },
        },
      );

      expect(res.status).toBe(500);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe('INTERNAL_SERVER_ERROR');
      // Must not leak the raw SQL / driver / file error string!
      expect(json.error.message).toBe('An unexpected internal error occurred');
      expect(json.error.message).not.toContain('FATAL');
      expect(json.error.message).not.toContain('secrets_internal');
    } finally {
      await brokenService.stop();
    }
  });
});
