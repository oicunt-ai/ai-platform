import { createServer, type Server } from 'node:http';
import { loadKnowledgeConfig, type KnowledgeConfig } from './config.js';
import type { DocumentRepositoryPort } from './application/ports/document-repository.port.js';
import type { VectorStorePort } from './application/ports/vector-store.port.js';
import type { ObjectStoragePort } from './application/ports/object-storage.port.js';
import type { EmbeddingServicePort } from './application/ports/embedding-service.port.js';
import type {
  DocumentProcessingQueuePort,
  DocumentProcessJob,
} from './application/ports/document-processing-queue.port.js';
import type { TextExtractorPort } from './application/ports/text-extractor.port.js';
import {
  CreateCollectionUseCase,
  DeleteCollectionUseCase,
  DeleteDocumentUseCase,
  GetCollectionUseCase,
  GetDocumentUseCase,
  ListCollectionsUseCase,
  ListDocumentsUseCase,
  ProcessDocumentJobUseCase,
  PurgeTenantKnowledgeUseCase,
  RegisterDocumentUseCase,
  RetrieveContextUseCase,
  RetryDocumentUseCase,
} from './application/use-cases/index.js';
import { DatabasePool } from './infrastructure/database/connection.js';
import { PostgresDocumentRepository } from './infrastructure/repositories/postgres-document.repository.js';
import { InMemoryDocumentRepository } from './infrastructure/repositories/in-memory-document.repository.js';
import { InMemoryVectorStore } from './infrastructure/vector-store/in-memory-vector-store.js';
import { InMemoryObjectStorage } from './infrastructure/object-storage/in-memory-object-storage.js';
import { MockEmbeddingService } from './infrastructure/embedding/mock-embedding-service.js';
import { InMemoryDocumentProcessingQueue } from './infrastructure/queue/in-memory-document-queue.js';
import { DefaultTextExtractor } from './infrastructure/extraction/default-text-extractor.js';
import { JsonLogger } from './infrastructure/logging/logger.js';
import {
  CollectionController,
  DocumentController,
  RetrievalController,
  AdminController,
} from './interfaces/http/controllers/index.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface KnowledgeServiceDependencies {
  readonly config?: KnowledgeConfig | undefined;
  readonly repository?: DocumentRepositoryPort | undefined;
  readonly vectorStore?: VectorStorePort | undefined;
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly embeddingService?: EmbeddingServicePort | undefined;
  readonly queue?: DocumentProcessingQueuePort | undefined;
  readonly textExtractor?: TextExtractorPort | undefined;
  readonly dbPool?: DatabasePool | undefined;
}

export class KnowledgeService {
  private readonly config: KnowledgeConfig;
  private readonly dbPool: DatabasePool | null;
  private readonly repository: DocumentRepositoryPort;
  private readonly vectorStore: VectorStorePort;
  private readonly objectStorage: ObjectStoragePort;
  private readonly embeddingService: EmbeddingServicePort;
  private readonly queue: DocumentProcessingQueuePort;
  private readonly textExtractor: TextExtractorPort;
  private readonly logger: JsonLogger;

  private readonly createCollectionUseCase: CreateCollectionUseCase;
  private readonly getCollectionUseCase: GetCollectionUseCase;
  private readonly listCollectionsUseCase: ListCollectionsUseCase;
  private readonly deleteCollectionUseCase: DeleteCollectionUseCase;
  private readonly registerDocumentUseCase: RegisterDocumentUseCase;
  private readonly getDocumentUseCase: GetDocumentUseCase;
  private readonly listDocumentsUseCase: ListDocumentsUseCase;
  private readonly deleteDocumentUseCase: DeleteDocumentUseCase;
  private readonly retryDocumentUseCase: RetryDocumentUseCase;
  private readonly processDocumentJobUseCase: ProcessDocumentJobUseCase;
  private readonly retrieveContextUseCase: RetrieveContextUseCase;
  private readonly purgeTenantKnowledgeUseCase: PurgeTenantKnowledgeUseCase;

  private readonly collectionController: CollectionController;
  private readonly documentController: DocumentController;
  private readonly retrievalController: RetrievalController;
  private readonly adminController: AdminController;

  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: KnowledgeServiceDependencies = {}) {
    this.config = dependencies.config ?? loadKnowledgeConfig();

    this.logger = new JsonLogger(
      this.config.serviceName,
      (this.config.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
    );

    if (dependencies.dbPool) {
      this.dbPool = dependencies.dbPool;
    } else if (dependencies.repository) {
      this.dbPool = null;
    } else if (this.config.environment === 'test') {
      this.dbPool = null;
    } else {
      this.dbPool = new DatabasePool({
        host: this.config.database.host,
        port: this.config.database.port,
        database: this.config.database.database,
        user: this.config.database.user,
        password: this.config.database.password,
        ssl: this.config.database.ssl,
        maxConnections: this.config.database.maxConnections,
        idleTimeoutMillis: this.config.database.idleTimeoutMs,
        connectionTimeoutMillis: this.config.database.connectionTimeoutMs,
      });
    }

    if (dependencies.repository) {
      this.repository = dependencies.repository;
    } else if (this.dbPool) {
      this.repository = new PostgresDocumentRepository(this.dbPool);
    } else {
      this.repository = new InMemoryDocumentRepository();
    }

    this.vectorStore = dependencies.vectorStore ?? new InMemoryVectorStore();
    this.objectStorage = dependencies.objectStorage ?? new InMemoryObjectStorage();
    this.embeddingService = dependencies.embeddingService ?? new MockEmbeddingService();
    this.queue = dependencies.queue ?? new InMemoryDocumentProcessingQueue();
    this.textExtractor = dependencies.textExtractor ?? new DefaultTextExtractor();

    this.createCollectionUseCase = new CreateCollectionUseCase(this.repository);
    this.getCollectionUseCase = new GetCollectionUseCase(this.repository);
    this.listCollectionsUseCase = new ListCollectionsUseCase(this.repository);
    this.deleteCollectionUseCase = new DeleteCollectionUseCase(this.repository, this.vectorStore);
    this.registerDocumentUseCase = new RegisterDocumentUseCase(this.repository, this.queue);
    this.getDocumentUseCase = new GetDocumentUseCase(this.repository);
    this.listDocumentsUseCase = new ListDocumentsUseCase(this.repository);
    this.deleteDocumentUseCase = new DeleteDocumentUseCase(
      this.repository,
      this.vectorStore,
      this.objectStorage,
    );
    this.retryDocumentUseCase = new RetryDocumentUseCase(this.repository, this.queue);
    this.processDocumentJobUseCase = new ProcessDocumentJobUseCase(
      this.repository,
      this.objectStorage,
      this.textExtractor,
      this.embeddingService,
      this.vectorStore,
    );
    this.retrieveContextUseCase = new RetrieveContextUseCase(
      this.repository,
      this.vectorStore,
      this.embeddingService,
    );
    this.purgeTenantKnowledgeUseCase = new PurgeTenantKnowledgeUseCase(
      this.repository,
      this.vectorStore,
      this.objectStorage,
    );

    // Register queue worker to process jobs if supported
    if (this.queue.registerWorker) {
      this.queue.registerWorker(async (job: DocumentProcessJob) => {
        await this.processDocumentJobUseCase.execute(job);
      });
    }

    this.collectionController = new CollectionController({
      createCollectionUseCase: this.createCollectionUseCase,
      getCollectionUseCase: this.getCollectionUseCase,
      listCollectionsUseCase: this.listCollectionsUseCase,
      deleteCollectionUseCase: this.deleteCollectionUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });

    this.documentController = new DocumentController({
      registerDocumentUseCase: this.registerDocumentUseCase,
      getDocumentUseCase: this.getDocumentUseCase,
      listDocumentsUseCase: this.listDocumentsUseCase,
      deleteDocumentUseCase: this.deleteDocumentUseCase,
      retryDocumentUseCase: this.retryDocumentUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });

    this.retrievalController = new RetrievalController({
      retrieveContextUseCase: this.retrieveContextUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });

    this.adminController = new AdminController({
      purgeTenantKnowledgeUseCase: this.purgeTenantKnowledgeUseCase,
    });
  }

  public getConfig(): KnowledgeConfig {
    return this.config;
  }

  public getRepository(): DocumentRepositoryPort {
    return this.repository;
  }

  public getVectorStore(): VectorStorePort {
    return this.vectorStore;
  }

  public getObjectStorage(): ObjectStoragePort {
    return this.objectStorage;
  }

  public getEmbeddingService(): EmbeddingServicePort {
    return this.embeddingService;
  }

  public getQueue(): DocumentProcessingQueuePort {
    return this.queue;
  }

  public getDbPool(): DatabasePool | null {
    return this.dbPool;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async initialize(): Promise<void> {
    const router = createHttpRouter({
      collectionController: this.collectionController,
      documentController: this.documentController,
      retrievalController: this.retrievalController,
      adminController: this.adminController,
      healthOptions: {
        isReady: () => this.ready,
        checkDbReady: this.dbPool ? () => this.dbPool!.ping() : undefined,
        checkVectorStoreReady: () => Promise.resolve(true),
        checkObjectStorageReady: () => Promise.resolve(true),
      },
      internalToken: this.config.internalToken,
      allowedServiceIdentities: this.config.allowedServiceIdentities,
    });

    this.server = createServer((req, res) => {
      router(req, res).catch((err: unknown) => {
        this.logger.error('Unhandled request processing error', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'INTERNAL_KNOWLEDGE_ERROR',
                message: 'Unhandled server error',
              },
            }),
          );
        }
      });
    });

    this.ready = true;
  }

  public async start(): Promise<number> {
    if (!this.server) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      this.server?.listen(this.config.port, this.config.host, () => {
        this.ready = true;
        const address = this.server?.address();
        const actualPort =
          typeof address === 'object' && address !== null ? address.port : this.config.port;

        this.logger.info(
          `Knowledge Service started on ${this.config.host}:${actualPort} [${this.config.environment}]`,
          {
            port: actualPort,
            environment: this.config.environment,
            service: this.config.serviceName,
          },
        );
        resolve(actualPort);
      });

      this.server?.on('error', (err) => {
        this.ready = false;
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    this.ready = false;
    return new Promise((resolve, reject) => {
      if (!this.server) {
        if (this.dbPool) {
          void this.dbPool.close().finally(() => resolve());
          return;
        }
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        resolve();
      }, this.config.shutdownTimeoutMs);

      this.server.close(async (err) => {
        clearTimeout(timeout);
        this.server = null;
        if (this.dbPool) {
          try {
            await this.dbPool.close();
          } catch {
            // suppress pool close errors during shutdown
          }
        }
        if (err) {
          reject(err);
        } else {
          this.logger.info('Knowledge Service stopped');
          resolve();
        }
      });
    });
  }
}
