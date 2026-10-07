import { createServer, type Server } from 'node:http';
import { loadMcpConfig, type McpConfig } from './config.js';
import type {
  McpClientRuntimePort,
  McpGatewaySessionStorePort,
  McpServerRepositoryPort,
  McpTransportFactoryPort,
  PerimeterAuthPort,
  SecretStorePort,
  ToolsServicePort,
} from './application/ports/index.js';
import {
  RegisterServerUseCase,
  GetServerUseCase,
  ListServersUseCase,
  DiscoverCapabilitiesUseCase,
  ExecuteToolUseCase,
  DisconnectServerUseCase,
  ServerGatewayUseCase,
} from './application/use-cases/index.js';
import { McpSecurityError } from './domain/errors.js';
import { DatabasePool, DatabaseMigrator } from './infrastructure/database/index.js';
import {
  InMemoryMcpGatewaySessionStore,
  InMemoryMcpServerRepository,
  PostgresMcpServerRepository,
} from './infrastructure/repositories/index.js';
import { TransportFactory } from './infrastructure/transports/index.js';
import { McpClientRuntime } from './infrastructure/runtime/index.js';
import { HttpToolsClient, InMemoryToolsService } from './infrastructure/clients/index.js';
import {
  InMemorySecretStore,
  PlatformPerimeterAuthAdapter,
} from './infrastructure/security/index.js';
import { JsonLogger } from './infrastructure/logging/index.js';
import {
  ServersController,
  ExecutionController,
  McpGatewayController,
} from './interfaces/http/controllers/index.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface McpServiceDependencies {
  readonly config?: McpConfig | undefined;
  readonly repository?: McpServerRepositoryPort | undefined;
  readonly clientRuntime?: McpClientRuntimePort | undefined;
  readonly toolsService?: ToolsServicePort | undefined;
  readonly secretStore?: SecretStorePort | undefined;
  readonly transportFactory?: McpTransportFactoryPort | undefined;
  readonly dbPool?: DatabasePool | undefined;
  readonly logger?: JsonLogger | undefined;
  readonly gatewaySessionStore?: McpGatewaySessionStorePort | undefined;
  readonly perimeterAuth?: PerimeterAuthPort | undefined;
}

export class McpService {
  private readonly config: McpConfig;
  private readonly dbPool: DatabasePool | null;
  private readonly repository: McpServerRepositoryPort;
  private readonly clientRuntime: McpClientRuntimePort;
  private readonly toolsService: ToolsServicePort;
  private readonly secretStore: SecretStorePort;
  private readonly transportFactory: McpTransportFactoryPort;
  private readonly gatewaySessionStore: McpGatewaySessionStorePort;
  private readonly perimeterAuth: PerimeterAuthPort;
  private readonly logger: JsonLogger;

  private readonly registerServerUseCase: RegisterServerUseCase;
  private readonly getServerUseCase: GetServerUseCase;
  private readonly listServersUseCase: ListServersUseCase;
  private readonly discoverCapabilitiesUseCase: DiscoverCapabilitiesUseCase;
  private readonly executeToolUseCase: ExecuteToolUseCase;
  private readonly disconnectServerUseCase: DisconnectServerUseCase;
  private readonly serverGatewayUseCase: ServerGatewayUseCase;
  private readonly mcpGatewayController: McpGatewayController;

  private readonly server: Server;
  private isRunning = false;

  constructor(dependencies: McpServiceDependencies = {}) {
    this.config = dependencies.config ?? loadMcpConfig();
    this.logger =
      dependencies.logger ??
      new JsonLogger('mcp', this.config.logLevel, {
        service: 'mcp',
      });

    if (this.config.isProduction && !dependencies.secretStore) {
      throw new McpSecurityError(
        'Production configuration requires an explicit external secret store adapter; in-memory fallback is prohibited in production',
      );
    }

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
      this.repository = new PostgresMcpServerRepository(this.dbPool);
    } else {
      this.repository = new InMemoryMcpServerRepository();
    }

    this.secretStore = dependencies.secretStore ?? new InMemorySecretStore();
    this.transportFactory =
      dependencies.transportFactory ??
      new TransportFactory(this.config.allowLocalhost, this.config.allowedStdioExecutables);

    this.clientRuntime =
      dependencies.clientRuntime ??
      new McpClientRuntime(this.repository, this.transportFactory, this.secretStore);

    if (dependencies.toolsService) {
      this.toolsService = dependencies.toolsService;
    } else if (this.config.toolsServiceUrl) {
      this.toolsService = new HttpToolsClient(
        this.config.toolsServiceUrl,
        this.config.internalToken,
      );
    } else {
      this.toolsService = new InMemoryToolsService();
    }

    this.registerServerUseCase = new RegisterServerUseCase(
      this.repository,
      this.config.allowedStdioExecutables,
    );
    this.getServerUseCase = new GetServerUseCase(this.repository);
    this.listServersUseCase = new ListServersUseCase(this.repository);
    this.discoverCapabilitiesUseCase = new DiscoverCapabilitiesUseCase(
      this.repository,
      this.clientRuntime,
      this.toolsService,
    );
    this.executeToolUseCase = new ExecuteToolUseCase(this.repository, this.clientRuntime);
    this.disconnectServerUseCase = new DisconnectServerUseCase(this.repository, this.clientRuntime);

    this.gatewaySessionStore =
      dependencies.gatewaySessionStore ??
      new InMemoryMcpGatewaySessionStore({
        inactivityTimeoutMs: this.config.serverSessionInactivityTimeoutMs,
        hardSessionTtlMs: this.config.serverSessionMaxTtlMs,
      });
    this.perimeterAuth =
      dependencies.perimeterAuth ??
      new PlatformPerimeterAuthAdapter({
        internalServiceToken: this.config.internalToken,
      });
    this.serverGatewayUseCase = new ServerGatewayUseCase(this.toolsService);
    this.mcpGatewayController = new McpGatewayController({
      serverGatewayUseCase: this.serverGatewayUseCase,
      sessionStore: this.gatewaySessionStore,
      perimeterAuth: this.perimeterAuth,
      config: this.config,
      logger: this.logger,
    });

    const serversController = new ServersController(
      this.registerServerUseCase,
      this.getServerUseCase,
      this.listServersUseCase,
      this.discoverCapabilitiesUseCase,
      this.disconnectServerUseCase,
    );
    const executionController = new ExecutionController(this.executeToolUseCase);

    const router = createHttpRouter({
      serversController,
      executionController,
      mcpGatewayController: this.mcpGatewayController,
      dbPool: this.dbPool,
      internalToken: this.config.internalToken,
      logger: this.logger,
    });

    this.server = createServer((req, res) => {
      void router(req, res);
    });
  }

  public async runMigrations(): Promise<void> {
    if (this.dbPool) {
      const migrator = new DatabaseMigrator(this.dbPool);
      await migrator.runMigrations();
    }
  }

  public async start(): Promise<number> {
    if (this.isRunning) {
      return (this.server.address() as { port: number })?.port ?? this.config.port;
    }

    if (this.dbPool) {
      await this.runMigrations();
    }

    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.port, this.config.host, () => {
        this.isRunning = true;
        this.server.removeListener('error', reject);
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.config.port;
        this.logger.info(`MCP service listening on ${this.config.host}:${actualPort}`);
        resolve(actualPort);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.clientRuntime instanceof McpClientRuntime) {
      await this.clientRuntime.closeAll();
    }

    return new Promise((resolve) => {
      this.server.close(async () => {
        this.isRunning = false;
        if (this.dbPool) {
          await this.dbPool.close().catch(() => {});
        }
        this.logger.info('MCP service stopped');
        resolve();
      });
    });
  }

  public getRepository(): McpServerRepositoryPort {
    return this.repository;
  }

  public getClientRuntime(): McpClientRuntimePort {
    return this.clientRuntime;
  }

  public getRegisterServerUseCase(): RegisterServerUseCase {
    return this.registerServerUseCase;
  }

  public getGetServerUseCase(): GetServerUseCase {
    return this.getServerUseCase;
  }

  public getListServersUseCase(): ListServersUseCase {
    return this.listServersUseCase;
  }

  public getDiscoverCapabilitiesUseCase(): DiscoverCapabilitiesUseCase {
    return this.discoverCapabilitiesUseCase;
  }

  public getExecuteToolUseCase(): ExecuteToolUseCase {
    return this.executeToolUseCase;
  }

  public getDisconnectServerUseCase(): DisconnectServerUseCase {
    return this.disconnectServerUseCase;
  }

  public getGatewaySessionStore(): McpGatewaySessionStorePort {
    return this.gatewaySessionStore;
  }

  public getServerGatewayUseCase(): ServerGatewayUseCase {
    return this.serverGatewayUseCase;
  }
}
