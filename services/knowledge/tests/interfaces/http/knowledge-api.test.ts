import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeService } from '../../../src/service.js';
import { loadKnowledgeConfig } from '../../../src/config.js';
import { InMemoryDocumentRepository } from '../../../src/infrastructure/repositories/in-memory-document.repository.js';
import { InMemoryVectorStore } from '../../../src/infrastructure/vector-store/in-memory-vector-store.js';
import { InMemoryObjectStorage } from '../../../src/infrastructure/object-storage/in-memory-object-storage.js';
import { MockEmbeddingService } from '../../../src/infrastructure/embedding/mock-embedding-service.js';
import { InMemoryDocumentProcessingQueue } from '../../../src/infrastructure/queue/in-memory-document-queue.js';
import type { CollectionResponseDto } from '../../../src/application/dtos/collection.dto.js';
import type {
  DocumentResponseDto,
  DocumentDeletedResponseDto,
} from '../../../src/application/dtos/document.dto.js';
import type { RetrievalResponseDto } from '../../../src/application/dtos/retrieval.dto.js';
import type { TenantPurgeResponseDto } from '../../../src/application/dtos/purge.dto.js';

interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: {
    readonly requestId?: string;
    readonly correlationId?: string;
    readonly timestamp?: string;
  };
}

describe('HTTP Interfaces - Knowledge Service API', () => {
  let service: KnowledgeService;
  let repository: InMemoryDocumentRepository;
  let vectorStore: InMemoryVectorStore;
  let objectStorage: InMemoryObjectStorage;
  let embeddingService: MockEmbeddingService;
  let queue: InMemoryDocumentProcessingQueue;
  let baseUrl: string;
  const internalToken = 'test-knowledge-internal-token';

  beforeEach(async () => {
    repository = new InMemoryDocumentRepository();
    vectorStore = new InMemoryVectorStore();
    objectStorage = new InMemoryObjectStorage();
    embeddingService = new MockEmbeddingService();
    queue = new InMemoryDocumentProcessingQueue({ autoProcess: true });

    const config = loadKnowledgeConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalToken,
      allowedServiceIdentities: ['ai-orchestrator', 'billy-api', 'ai-platform-admin'],
    });

    service = new KnowledgeService({
      config,
      repository,
      vectorStore,
      objectStorage,
      embeddingService,
      queue,
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
      expect(data.status).toBe('ready');
    });
  });

  describe('Authentication & Service Identity Verification', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/knowledge/collections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Name': 'ai-orchestrator',
          'X-Tenant-Id': 'tenant-123',
        },
        body: JSON.stringify({
          name: 'Col 1',
          embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
        }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 when X-Service-Name is not authorized', async () => {
      const res = await fetch(`${baseUrl}/internal/v1/knowledge/collections`, {
        method: 'POST',
        headers: authHeaders('unauthorized-service'),
        body: JSON.stringify({
          name: 'Col 1',
          embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
        }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 when X-Tenant-Id header is missing', async () => {
      const headers = { ...authHeaders() };
      delete (headers as Record<string, string>)['X-Tenant-Id'];

      const res = await fetch(`${baseUrl}/internal/v1/knowledge/collections`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Col 1',
          embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Knowledge Collections API', () => {
    it('creates, gets, lists, and deletes collections', async () => {
      // 1. Create collection
      const createRes = await fetch(`${baseUrl}/internal/v1/knowledge/collections`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: 'Engineering Knowledge Base',
          description: 'API specs and architecture',
          embeddingConfig: {
            modelId: 'text-embedding-3-small',
            dimensions: 1536,
            version: '1.0.0',
          },
        }),
      });
      expect(createRes.status).toBe(201);
      const createdBody = (await createRes.json()) as ApiSuccessResponse<CollectionResponseDto>;
      expect(createdBody.success).toBe(true);
      expect(createdBody.data.name).toBe('Engineering Knowledge Base');
      const collectionId = createdBody.data.id;

      // 2. Get collection
      const getRes = await fetch(`${baseUrl}/internal/v1/knowledge/collections/${collectionId}`, {
        headers: authHeaders(),
      });
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as ApiSuccessResponse<CollectionResponseDto>;
      expect(getBody.data.id).toBe(collectionId);

      // 3. List collections
      const listRes = await fetch(`${baseUrl}/internal/v1/knowledge/collections`, {
        headers: authHeaders(),
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as ApiSuccessResponse<CollectionResponseDto[]>;
      expect(listBody.data).toHaveLength(1);

      // 4. Delete collection
      const delRes = await fetch(`${baseUrl}/internal/v1/knowledge/collections/${collectionId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(delRes.status).toBe(200);
    });
  });

  describe('Document Ingestion & Retrieval API', () => {
    it('stages document, processes asynchronously, and allows semantic retrieval', async () => {
      // 1. Create collection
      const colRes = await fetch(`${baseUrl}/internal/v1/knowledge/collections`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: 'Policies',
          embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
        }),
      });
      const colBody = (await colRes.json()) as ApiSuccessResponse<CollectionResponseDto>;
      const collectionId = colBody.data.id;

      // 2. Put file in object storage
      const objKey = 'tenant-123/policies/security.txt';
      await objectStorage.putObject(
        objKey,
        Buffer.from(
          'Security Policy: Two-factor authentication is strictly required for all administrative access.',
        ),
        { mimeType: 'text/plain', tenantId: 'tenant-123' },
      );

      // 3. Register document (POST /internal/v1/knowledge/collections/:id/documents)
      const regRes = await fetch(
        `${baseUrl}/internal/v1/knowledge/collections/${collectionId}/documents`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            title: 'Security Policy',
            mimeType: 'text/plain',
            objectKey: objKey,
            sourceUri: 's3://bucket/sec.txt',
            contentLengthBytes: 90,
          }),
        },
      );
      expect(regRes.status).toBe(202);
      const regBody = (await regRes.json()) as ApiSuccessResponse<DocumentResponseDto>;
      expect(regBody.success).toBe(true);
      expect(regBody.data.status).toBe('queued');
      const documentId = regBody.data.id;

      // Wait a tick for asynchronous queue worker to finish processing
      await new Promise((r) => setTimeout(r, 50));

      // 4. Verify document is now ready
      const docRes = await fetch(`${baseUrl}/internal/v1/knowledge/documents/${documentId}`, {
        headers: authHeaders(),
      });
      expect(docRes.status).toBe(200);
      const docBody = (await docRes.json()) as ApiSuccessResponse<DocumentResponseDto>;
      expect(docBody.data.status).toBe('ready');
      expect(docBody.data.totalChunks).toBeGreaterThan(0);

      // 5. Semantic retrieval (POST /internal/v1/knowledge/retrieve)
      const retRes = await fetch(`${baseUrl}/internal/v1/knowledge/retrieve`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          query: 'What authentication is required for admins?',
          collectionIds: [collectionId],
          topK: 3,
        }),
      });
      expect(retRes.status).toBe(200);
      const retBody = (await retRes.json()) as ApiSuccessResponse<RetrievalResponseDto>;
      expect(retBody.data.chunks).toHaveLength(1);
      expect(retBody.data.chunks[0]!.text).toContain('Two-factor authentication');
      expect(retBody.data.chunks[0]!.provenance.documentTitle).toBe('Security Policy');

      // 6. Delete document (DELETE /internal/v1/knowledge/documents/:id)
      const delDocRes = await fetch(`${baseUrl}/internal/v1/knowledge/documents/${documentId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(delDocRes.status).toBe(200);
      const delDocBody = (await delDocRes.json()) as ApiSuccessResponse<DocumentDeletedResponseDto>;
      expect(delDocBody.data.status).toBe('deleted');

      // 7. Verify IMMEDIATE retrieval exclusion
      const retResAfter = await fetch(`${baseUrl}/internal/v1/knowledge/retrieve`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          query: 'What authentication is required for admins?',
          collectionIds: [collectionId],
          topK: 3,
        }),
      });
      expect(retResAfter.status).toBe(200);
      const retBodyAfter = (await retResAfter.json()) as ApiSuccessResponse<RetrievalResponseDto>;
      expect(retBodyAfter.data.chunks).toHaveLength(0);
    });
  });

  describe('Tenant Purge API', () => {
    it('purges all tenant knowledge via POST /internal/v1/knowledge/admin/tenants/:tenantId/purge', async () => {
      const purgeRes = await fetch(
        `${baseUrl}/internal/v1/knowledge/admin/tenants/tenant-123/purge`,
        {
          method: 'POST',
          headers: authHeaders('ai-platform-admin'),
        },
      );
      expect(purgeRes.status).toBe(200);
      const purgeBody = (await purgeRes.json()) as ApiSuccessResponse<TenantPurgeResponseDto>;
      expect(purgeBody.data.tenantId).toBe('tenant-123');
      expect(purgeBody.data.purgedAt).toBeDefined();
    });
  });
});
