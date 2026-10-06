import { createServer, type Server } from 'node:http';
import { loadToolsConfig, type ToolsConfig } from './config.js';
import { BUILT_IN_TOOLS, ConfirmationManager } from './domain/index.js';
import type {
  IdempotencyStorePort,
  ObjectStoragePort,
  ToolAuditRepositoryPort,
  ToolExecutorPort,
  ToolRepositoryPort,
} from './application/ports/index.js';
import {
  CancelExecutionUseCase,
  DiscoverToolsUseCase,
  ExecuteToolAsyncUseCase,
  ExecuteToolSyncUseCase,
  GetExecutionStatusUseCase,
  GetToolUseCase,
  RegisterToolUseCase,
} from './application/use-cases/index.js';
import { DatabasePool, DatabaseMigrator } from './infrastructure/database/index.js';
import {
  InMemoryToolRepository,
  PostgresToolRepository,
  InMemoryToolAuditRepository,
  PostgresToolAuditRepository,
} from './infrastructure/repositories/index.js';
import { ToolExecutorRouter } from './infrastructure/adapters/index.js';
import { InMemoryIdempotencyStore } from './infrastructure/idempotency/index.js';
import { InMemoryObjectStorage } from './infrastructure/storage/index.js';
import { JsonLogger } from './infrastructure/logging/index.js';
import { ToolsController, ExecutionController } from './interfaces/http/controllers/index.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface ToolsServiceDependencies {
  readonly config?: ToolsConfig | undefined;
  readonly repository?: ToolRepositoryPort | undefined;
  readonly executor?: ToolExecutorPort | undefined;
  readonly auditRepository?: ToolAuditRepositoryPort | undefined;
  readonly idempotencyStore?: IdempotencyStorePort | undefined;
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly dbPool?: DatabasePool | undefined;
  readonly logger?: JsonLogger | undefined;
}

export class ToolsService {
  private readonly config: ToolsConfig;
  private readonly dbPool: DatabasePool | null;
  private readonly repository: ToolRepositoryPort;
  private readonly executor: ToolExecutorPort;
  private readonly auditRepository: ToolAuditRepositoryPort;
  private readonly idempotencyStore: IdempotencyStorePort;
  private readonly objectStorage: ObjectStoragePort;
  private readonly confirmationManager: ConfirmationManager;
  private readonly logger: JsonLogger;

  private readonly discoverToolsUseCase: DiscoverToolsUseCase;
  private readonly getToolUseCase: GetToolUseCase;
  private readonly registerToolUseCase: RegisterToolUseCase;
  private readonly executeSyncUseCase: ExecuteToolSyncUseCase;
  private readonly executeAsyncUseCase: ExecuteToolAsyncUseCase;
  private readonly getStatusUseCase: GetExecutionStatusUseCase;
  private readonly cancelUseCase: CancelExecutionUseCase;

  private readonly server: Server;
  private isRunning = false;

  constructor(dependencies: ToolsServiceDependencies = {}) {
    this.config = dependencies.config ?? loadToolsConfig();
    this.logger =
      dependencies.logger ??
      new JsonLogger('tools', this.config.logLevel, {
        service: 'tools',
      });

    if (dependencies.dbPool) {
      this.dbPool = dependencies.dbPool;
    } else if (this.config.useDatabase) {
      this.dbPool = new DatabasePool(this.config.database);
    } else {
      this.dbPool = null;
    }

    if (dependencies.repository) {
      this.repository = dependencies.repository;
    } else if (this.dbPool) {
      this.repository = new PostgresToolRepository(this.dbPool);
    } else {
      this.repository = new InMemoryToolRepository();
    }

    if (dependencies.auditRepository) {
      this.auditRepository = dependencies.auditRepository;
    } else if (this.dbPool) {
      this.auditRepository = new PostgresToolAuditRepository(this.dbPool);
    } else {
      this.auditRepository = new InMemoryToolAuditRepository();
    }

    this.idempotencyStore = dependencies.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.objectStorage = dependencies.objectStorage ?? new InMemoryObjectStorage();
    this.executor = dependencies.executor ?? new ToolExecutorRouter();
    this.confirmationManager = new ConfirmationManager({
      privateKey: this.config.confirmationPrivateKey,
      publicKey: this.config.confirmationPublicKey,
    });

    this.discoverToolsUseCase = new DiscoverToolsUseCase(this.repository);
    this.getToolUseCase = new GetToolUseCase(this.repository);
    this.registerToolUseCase = new RegisterToolUseCase(this.repository);
    this.executeSyncUseCase = new ExecuteToolSyncUseCase(
      this.repository,
      this.executor,
      this.confirmationManager,
      this.auditRepository,
      this.idempotencyStore,
      this.objectStorage,
    );
    this.executeAsyncUseCase = new ExecuteToolAsyncUseCase(
      this.repository,
      this.executeSyncUseCase,
    );
    this.getStatusUseCase = new GetExecutionStatusUseCase(this.repository);
    this.cancelUseCase = new CancelExecutionUseCase(this.repository);

    const toolsController = new ToolsController(
      this.discoverToolsUseCase,
      this.getToolUseCase,
      this.registerToolUseCase,
    );
    const executionController = new ExecutionController(
      this.executeSyncUseCase,
      this.executeAsyncUseCase,
      this.getStatusUseCase,
      this.cancelUseCase,
    );

    const router = createHttpRouter({
      toolsController,
      executionController,
      dbPool: this.dbPool,
      internalToken: this.config.internalToken,
      logger: this.logger,
    });

    this.server = createServer(router);
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    if (this.dbPool) {
      const migrator = new DatabaseMigrator(this.dbPool);
      const migrationResult = await migrator.runMigrations();
      this.logger.info('Database migrations applied successfully', {
        applied: migrationResult.applied.length,
      });
    }

    // Seed built-in tools
    for (const tool of BUILT_IN_TOOLS) {
      const existing = await this.repository.findById(tool.toolId, tool.version);
      if (!existing) {
        await this.repository.saveTool(tool);
      }
    }

    await new Promise<void>((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.isRunning = true;
        this.logger.info(`Tools Service listening on ${this.config.host}:${this.config.port}`, {
          port: this.config.port,
          host: this.config.host,
        });
        resolve();
      });
      this.server.once('error', reject);
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => {
        this.isRunning = false;
        resolve();
      });
    });

    if (this.dbPool) {
      await this.dbPool.close();
    }

    this.logger.info('Tools Service stopped');
  }

  public getHttpServer(): Server {
    return this.server;
  }

  public getRepository(): ToolRepositoryPort {
    return this.repository;
  }

  public getExecutor(): ToolExecutorPort {
    return this.executor;
  }

  public getConfirmationManager(): ConfirmationManager {
    return this.confirmationManager;
  }

  public getAuditRepository(): ToolAuditRepositoryPort {
    return this.auditRepository;
  }

  public getIdempotencyStore(): IdempotencyStorePort {
    return this.idempotencyStore;
  }

  public getObjectStorage(): ObjectStoragePort {
    return this.objectStorage;
  }
}
