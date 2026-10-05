import { createServer, type Server } from 'node:http';
import { loadModelRegistryConfig, type ModelRegistryConfig } from './config.js';
import type { ModelRepositoryPort } from './application/ports/model-repository.port.js';
import type { AuditRepositoryPort } from './application/ports/audit-repository.port.js';
import type { ModelCachePort } from './application/ports/model-cache.port.js';
import { DatabasePool } from './infrastructure/database/connection.js';
import { PostgresModelRepository } from './infrastructure/repositories/postgres-model.repository.js';
import { PostgresAuditRepository } from './infrastructure/repositories/postgres-audit.repository.js';
import { InMemoryModelRepository } from './infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryAuditRepository } from './infrastructure/repositories/in-memory-audit.repository.js';
import { InMemoryModelCache } from './infrastructure/cache/in-memory-model-cache.js';
import { NoopModelCache } from './infrastructure/cache/noop-model-cache.js';
import {
  CreateCanonicalModelUseCase,
  CreateModelTargetUseCase,
  CreateModelVersionUseCase,
  GetModelUseCase,
  ListModelsUseCase,
  ResolveModelUseCase,
  SetModelAliasUseCase,
  UpdateModelTargetStatusUseCase,
  UpdateModelVersionStatusUseCase,
  UpdateRoutingPolicyUseCase,
} from './application/use-cases/index.js';
import { ResolutionController } from './interfaces/http/controllers/resolution.controller.js';
import { CatalogController } from './interfaces/http/controllers/catalog.controller.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface ModelRegistryDependencies {
  readonly config?: ModelRegistryConfig | undefined;
  readonly modelRepository?: ModelRepositoryPort | undefined;
  readonly auditRepository?: AuditRepositoryPort | undefined;
  readonly cache?: ModelCachePort | undefined;
  readonly dbPool?: DatabasePool | undefined;
}

export class ModelRegistryService {
  private readonly config: ModelRegistryConfig;
  private readonly dbPool: DatabasePool | null;
  private readonly modelRepository: ModelRepositoryPort;
  private readonly auditRepository: AuditRepositoryPort;
  private readonly cache: ModelCachePort;
  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: ModelRegistryDependencies = {}) {
    this.config = dependencies.config ?? loadModelRegistryConfig();

    if (dependencies.dbPool) {
      this.dbPool = dependencies.dbPool;
    } else if (dependencies.modelRepository) {
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

    if (dependencies.modelRepository) {
      this.modelRepository = dependencies.modelRepository;
    } else if (this.dbPool) {
      this.modelRepository = new PostgresModelRepository(this.dbPool);
    } else {
      this.modelRepository = new InMemoryModelRepository();
    }

    if (dependencies.auditRepository) {
      this.auditRepository = dependencies.auditRepository;
    } else if (this.dbPool) {
      this.auditRepository = new PostgresAuditRepository(this.dbPool);
    } else {
      this.auditRepository = new InMemoryAuditRepository();
    }

    if (dependencies.cache) {
      this.cache = dependencies.cache;
    } else if (this.config.cache.enabled) {
      this.cache = new InMemoryModelCache({
        defaultTtlSeconds: this.config.cache.defaultTtlSeconds,
      });
    } else {
      this.cache = new NoopModelCache();
    }
  }

  public getConfig(): ModelRegistryConfig {
    return this.config;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public getModelRepository(): ModelRepositoryPort {
    return this.modelRepository;
  }

  public getAuditRepository(): AuditRepositoryPort {
    return this.auditRepository;
  }

  public getCache(): ModelCachePort {
    return this.cache;
  }

  public async initialize(): Promise<void> {
    const resolveModelUseCase = new ResolveModelUseCase(this.modelRepository, this.cache, {
      defaultCacheTtlSeconds: this.config.cache.defaultTtlSeconds,
    });

    const getModelUseCase = new GetModelUseCase(this.modelRepository);
    const listModelsUseCase = new ListModelsUseCase(this.modelRepository);
    const createCanonicalModelUseCase = new CreateCanonicalModelUseCase(
      this.modelRepository,
      this.auditRepository,
      this.cache,
    );
    const createModelVersionUseCase = new CreateModelVersionUseCase(
      this.modelRepository,
      this.auditRepository,
      this.cache,
    );
    const updateModelVersionStatusUseCase = new UpdateModelVersionStatusUseCase(
      this.modelRepository,
      this.auditRepository,
      this.cache,
    );
    const createModelTargetUseCase = new CreateModelTargetUseCase(
      this.modelRepository,
      this.auditRepository,
      this.cache,
    );
    const updateModelTargetStatusUseCase = new UpdateModelTargetStatusUseCase(
      this.modelRepository,
      this.auditRepository,
      this.cache,
    );
    const updateRoutingPolicyUseCase = new UpdateRoutingPolicyUseCase(
      this.modelRepository,
      this.auditRepository,
      this.cache,
    );
    const setModelAliasUseCase = new SetModelAliasUseCase(
      this.modelRepository,
      this.auditRepository,
      this.cache,
    );

    const resolutionController = new ResolutionController(resolveModelUseCase);
    const catalogController = new CatalogController({
      getModelUseCase,
      listModelsUseCase,
      createCanonicalModelUseCase,
      createModelVersionUseCase,
      updateModelVersionStatusUseCase,
      createModelTargetUseCase,
      updateModelTargetStatusUseCase,
      updateRoutingPolicyUseCase,
      setModelAliasUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });

    const router = createHttpRouter({
      serviceName: this.config.serviceName,
      version: this.config.version,
      isReady: () => this.ready,
      checkDbReady: this.dbPool ? () => this.dbPool!.ping() : undefined,
      resolutionController,
      catalogController,
      config: this.config,
    });

    this.server = createServer((req, res) => {
      void router(req, res);
    });

    this.ready = true;
  }

  public async start(): Promise<number> {
    if (!this.server) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialized'));
        return;
      }

      this.server.listen(this.config.port, this.config.host, () => {
        const address = this.server?.address();
        const actualPort =
          typeof address === 'object' && address !== null ? address.port : this.config.port;
        resolve(actualPort);
      });

      this.server.on('error', (err) => {
        this.ready = false;
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    this.ready = false;

    if (!this.server) {
      if (this.dbPool) {
        await this.dbPool.close();
      }
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve();
      }, this.config.shutdownTimeoutMs);

      this.server?.close(async (err) => {
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
          resolve();
        }
      });
    });
  }
}
