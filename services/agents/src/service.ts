import { createServer, type Server } from 'node:http';
import { loadAgentsConfig, type AgentsConfig } from './config.js';
import { BUILT_IN_AGENTS } from './domain/built-in-agents.js';
import type {
  AgentQueuePort,
  AgentRepositoryPort,
  InferenceClientPort,
  KnowledgeClientPort,
  RunRepositoryPort,
  ToolsClientPort,
} from './application/ports/index.js';
import {
  CancelRunUseCase,
  ExecuteRunLoopUseCase,
  GetAgentUseCase,
  GetRunUseCase,
  GetStepsUseCase,
  ListAgentsUseCase,
  RegisterAgentUseCase,
  ResumeRunUseCase,
  StartRunUseCase,
} from './application/use-cases/index.js';
import { DatabaseMigrator, DatabasePool } from './infrastructure/database/index.js';
import {
  InMemoryAgentRepository,
  InMemoryRunRepository,
  PostgresAgentRepository,
  PostgresRunRepository,
} from './infrastructure/repositories/index.js';
import {
  HttpInferenceClient,
  HttpKnowledgeClient,
  HttpToolsClient,
} from './infrastructure/clients/index.js';
import { InMemoryAgentQueue, RabbitMqAgentQueue } from './infrastructure/queue/index.js';
import { JsonLogger } from './infrastructure/logging/index.js';
import {
  InMemoryAgentMetricsCollector,
  type AgentMetricsCollector,
} from './infrastructure/observability/index.js';
import { AgentsController, RunsController } from './interfaces/http/controllers/index.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface AgentsServiceDependencies {
  readonly config?: AgentsConfig | undefined;
  readonly agentRepository?: AgentRepositoryPort | undefined;
  readonly runRepository?: RunRepositoryPort | undefined;
  readonly inferenceClient?: InferenceClientPort | undefined;
  readonly toolsClient?: ToolsClientPort | undefined;
  readonly knowledgeClient?: KnowledgeClientPort | undefined;
  readonly queue?: AgentQueuePort | undefined;
  readonly dbPool?: DatabasePool | undefined;
  readonly logger?: JsonLogger | undefined;
  readonly metrics?: AgentMetricsCollector | undefined;
}

export class AgentsService {
  private readonly config: AgentsConfig;
  private readonly dbPool: DatabasePool | null;
  private readonly agentRepository: AgentRepositoryPort;
  private readonly runRepository: RunRepositoryPort;
  private readonly inferenceClient: InferenceClientPort;
  private readonly toolsClient: ToolsClientPort;
  private readonly knowledgeClient: KnowledgeClientPort;
  private readonly queue: AgentQueuePort;
  private readonly logger: JsonLogger;
  private readonly metrics: AgentMetricsCollector;

  private readonly executeRunLoopUseCase: ExecuteRunLoopUseCase;
  private readonly startRunUseCase: StartRunUseCase;
  private readonly resumeRunUseCase: ResumeRunUseCase;
  private readonly cancelRunUseCase: CancelRunUseCase;
  private readonly getRunUseCase: GetRunUseCase;
  private readonly getStepsUseCase: GetStepsUseCase;
  private readonly listAgentsUseCase: ListAgentsUseCase;
  private readonly getAgentUseCase: GetAgentUseCase;
  private readonly registerAgentUseCase: RegisterAgentUseCase;

  private readonly server: Server;
  private isRunning = false;

  constructor(dependencies: AgentsServiceDependencies = {}) {
    this.config = dependencies.config ?? loadAgentsConfig();
    this.logger =
      dependencies.logger ??
      new JsonLogger('agents', this.config.logLevel, {
        service: 'agents',
      });
    this.metrics = dependencies.metrics ?? new InMemoryAgentMetricsCollector();

    if (dependencies.dbPool) {
      this.dbPool = dependencies.dbPool;
    } else if (this.config.useDatabase) {
      this.dbPool = new DatabasePool(this.config.database);
    } else {
      this.dbPool = null;
    }

    if (dependencies.agentRepository) {
      this.agentRepository = dependencies.agentRepository;
    } else if (this.dbPool) {
      this.agentRepository = new PostgresAgentRepository(this.dbPool);
    } else {
      this.agentRepository = new InMemoryAgentRepository();
    }

    if (dependencies.runRepository) {
      this.runRepository = dependencies.runRepository;
    } else if (this.dbPool) {
      this.runRepository = new PostgresRunRepository(this.dbPool);
    } else {
      this.runRepository = new InMemoryRunRepository();
    }

    this.inferenceClient =
      dependencies.inferenceClient ??
      new HttpInferenceClient({
        baseUrl: this.config.inferenceServiceUrl,
        internalToken: this.config.internalToken,
      });

    this.toolsClient =
      dependencies.toolsClient ??
      new HttpToolsClient({
        baseUrl: this.config.toolsServiceUrl,
        internalToken: this.config.internalToken,
      });

    this.knowledgeClient =
      dependencies.knowledgeClient ??
      new HttpKnowledgeClient({
        baseUrl: this.config.knowledgeServiceUrl,
        internalToken: this.config.internalToken,
      });

    if (dependencies.queue) {
      this.queue = dependencies.queue;
    } else if (this.config.useRabbitMq) {
      this.queue = new RabbitMqAgentQueue({
        url: this.config.rabbitmqUrl,
        exchange: 'oicunt.agents',
        routingKey: 'agent.run.dispatch',
        queueName: 'oicunt.agents.runs',
      });
    } else {
      this.queue = new InMemoryAgentQueue();
    }

    this.executeRunLoopUseCase = new ExecuteRunLoopUseCase(
      this.runRepository,
      this.inferenceClient,
      this.toolsClient,
    );

    this.startRunUseCase = new StartRunUseCase(
      this.agentRepository,
      this.runRepository,
      this.queue,
      this.executeRunLoopUseCase,
    );

    this.resumeRunUseCase = new ResumeRunUseCase(
      this.agentRepository,
      this.runRepository,
      this.executeRunLoopUseCase,
    );

    this.cancelRunUseCase = new CancelRunUseCase(this.runRepository);
    this.getRunUseCase = new GetRunUseCase(this.runRepository);
    this.getStepsUseCase = new GetStepsUseCase(this.runRepository);
    this.listAgentsUseCase = new ListAgentsUseCase(this.agentRepository);
    this.getAgentUseCase = new GetAgentUseCase(this.agentRepository);
    this.registerAgentUseCase = new RegisterAgentUseCase(this.agentRepository);

    // Register async worker if queue supports it
    if (typeof this.queue.registerWorker === 'function') {
      this.queue.registerWorker(async (job) => {
        const workerId = `worker_${process.pid}_${Date.now()}`;
        const hasLease = await this.runRepository.acquireLease(job.runId, workerId, 30000);
        if (!hasLease) {
          return;
        }

        try {
          const run = await this.runRepository.getRun(job.tenantId, job.runId);
          if (!run || run.status === 'cancelled') {
            return;
          }

          const agent = await this.agentRepository.getAgent(run.agentId);
          if (!agent) {
            return;
          }

          const version = await this.agentRepository.getAgentVersion(run.agentId, run.agentVersion);
          if (!version) {
            return;
          }

          const checkpoint = await this.runRepository.getLatestCheckpoint(run.runId);
          const goalInput = checkpoint?.statePayload.goalInput ?? '';

          await this.executeRunLoopUseCase.execute(run, version, goalInput);
        } catch (err: unknown) {
          this.logger.error('Worker failed to process async agent job', {
            runId: job.runId,
            error: String(err),
          });
        } finally {
          await this.runRepository.releaseLease(job.runId, workerId);
        }
      });
    }

    const agentsController = new AgentsController(
      this.listAgentsUseCase,
      this.getAgentUseCase,
      this.registerAgentUseCase,
    );

    const runsController = new RunsController(
      this.startRunUseCase,
      this.getRunUseCase,
      this.getStepsUseCase,
      this.resumeRunUseCase,
      this.cancelRunUseCase,
    );

    const router = createHttpRouter({
      agentsController,
      runsController,
      dbPool: this.dbPool,
      queue: this.queue,
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

    // Seed built-in agents
    for (const entry of BUILT_IN_AGENTS) {
      const existing = await this.agentRepository.getAgent(entry.agent.agentId);
      if (!existing) {
        await this.agentRepository.saveAgent(entry.agent);
        await this.agentRepository.saveAgentVersion(entry.version);
      }
    }

    await new Promise<void>((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.isRunning = true;
        this.logger.info(`Agents Service listening on ${this.config.host}:${this.config.port}`, {
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

    if (this.queue && typeof this.queue.close === 'function') {
      await this.queue.close();
    }

    this.logger.info('Agents Service stopped');
  }

  public getHttpServer(): Server {
    return this.server;
  }

  public getAgentRepository(): AgentRepositoryPort {
    return this.agentRepository;
  }

  public getRunRepository(): RunRepositoryPort {
    return this.runRepository;
  }

  public getInferenceClient(): InferenceClientPort {
    return this.inferenceClient;
  }

  public getToolsClient(): ToolsClientPort {
    return this.toolsClient;
  }

  public getKnowledgeClient(): KnowledgeClientPort {
    return this.knowledgeClient;
  }

  public getQueue(): AgentQueuePort {
    return this.queue;
  }

  public getMetrics(): AgentMetricsCollector {
    return this.metrics;
  }
}
