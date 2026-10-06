import { createServer, type Server } from 'node:http';
import { loadMemoryConfig, type MemoryConfig } from './config.js';
import type { ConversationRepositoryPort } from './application/ports/conversation-repository.port.js';
import {
  AppendMessagesUseCase,
  CreateConversationUseCase,
  DeleteConversationUseCase,
  GetContextUseCase,
  GetConversationUseCase,
  ListConversationsUseCase,
  ListMessagesUseCase,
  PurgeDataUseCase,
  UpdateConversationUseCase,
} from './application/use-cases/index.js';
import { DatabasePool } from './infrastructure/database/connection.js';
import { PostgresConversationRepository } from './infrastructure/repositories/postgres-conversation.repository.js';
import { InMemoryConversationRepository } from './infrastructure/repositories/in-memory-conversation.repository.js';
import { JsonLogger } from './infrastructure/logging/logger.js';
import {
  ContextController,
  ConversationController,
  MessageController,
  PurgeController,
} from './interfaces/http/controllers/index.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface MemoryServiceDependencies {
  readonly config?: MemoryConfig | undefined;
  readonly repository?: ConversationRepositoryPort | undefined;
  readonly dbPool?: DatabasePool | undefined;
}

export class MemoryService {
  private readonly config: MemoryConfig;
  private readonly dbPool: DatabasePool | null;
  private readonly repository: ConversationRepositoryPort;
  private readonly logger: JsonLogger;

  private readonly createConversationUseCase: CreateConversationUseCase;
  private readonly getConversationUseCase: GetConversationUseCase;
  private readonly listConversationsUseCase: ListConversationsUseCase;
  private readonly updateConversationUseCase: UpdateConversationUseCase;
  private readonly deleteConversationUseCase: DeleteConversationUseCase;
  private readonly appendMessagesUseCase: AppendMessagesUseCase;
  private readonly listMessagesUseCase: ListMessagesUseCase;
  private readonly getContextUseCase: GetContextUseCase;
  private readonly purgeDataUseCase: PurgeDataUseCase;

  private readonly conversationController: ConversationController;
  private readonly messageController: MessageController;
  private readonly contextController: ContextController;
  private readonly purgeController: PurgeController;

  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: MemoryServiceDependencies = {}) {
    this.config = dependencies.config ?? loadMemoryConfig();

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
      this.repository = new PostgresConversationRepository(this.dbPool);
    } else {
      this.repository = new InMemoryConversationRepository();
    }

    this.createConversationUseCase = new CreateConversationUseCase(this.repository);
    this.getConversationUseCase = new GetConversationUseCase(this.repository);
    this.listConversationsUseCase = new ListConversationsUseCase(this.repository);
    this.updateConversationUseCase = new UpdateConversationUseCase(this.repository);
    this.deleteConversationUseCase = new DeleteConversationUseCase(this.repository);
    this.appendMessagesUseCase = new AppendMessagesUseCase(this.repository);
    this.listMessagesUseCase = new ListMessagesUseCase(this.repository);
    this.getContextUseCase = new GetContextUseCase(this.repository);
    this.purgeDataUseCase = new PurgeDataUseCase(this.repository);

    this.conversationController = new ConversationController({
      createConversationUseCase: this.createConversationUseCase,
      getConversationUseCase: this.getConversationUseCase,
      listConversationsUseCase: this.listConversationsUseCase,
      updateConversationUseCase: this.updateConversationUseCase,
      deleteConversationUseCase: this.deleteConversationUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });

    this.messageController = new MessageController({
      appendMessagesUseCase: this.appendMessagesUseCase,
      listMessagesUseCase: this.listMessagesUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });

    this.contextController = new ContextController({
      getContextUseCase: this.getContextUseCase,
      defaultMaxTokens: this.config.defaultMaxTokens,
      defaultMaxMessages: this.config.defaultMaxMessages,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });

    this.purgeController = new PurgeController({
      purgeDataUseCase: this.purgeDataUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });
  }

  public getConfig(): MemoryConfig {
    return this.config;
  }

  public getRepository(): ConversationRepositoryPort {
    return this.repository;
  }

  public getDbPool(): DatabasePool | null {
    return this.dbPool;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async initialize(): Promise<void> {
    const router = createHttpRouter({
      conversationController: this.conversationController,
      messageController: this.messageController,
      contextController: this.contextController,
      purgeController: this.purgeController,
      healthOptions: {
        isReady: () => this.ready,
        checkDbReady: this.dbPool ? () => this.dbPool!.ping() : undefined,
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
                code: 'INTERNAL_MEMORY_ERROR',
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
          `Memory Service started on ${this.config.host}:${actualPort} [${this.config.environment}]`,
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
          this.logger.info('Memory Service stopped');
          resolve();
        }
      });
    });
  }
}
