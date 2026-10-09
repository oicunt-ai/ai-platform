import { createServer, type Server } from 'node:http';
import type { AiMetricsRecorder, AiTracer } from '@oicunt-ai/observability';
import { NoopAiMetricsRecorder, NoopAiTracer } from '@oicunt-ai/observability';
import { loadAiOrchestratorConfig, type AiOrchestratorConfig } from './config.js';
import type { ModelRegistryPort } from './application/ports/model-registry.port.js';
import type { InferencePort } from './application/ports/inference.port.js';
import type { MemoryPort } from './application/ports/memory.port.js';
import type { ResolutionCachePort } from './application/ports/resolution-cache.port.js';
import { CoordinateChatTurnUseCase } from './application/use-cases/coordinate-chat-turn.use-case.js';
import { InMemoryResolutionCache } from './infrastructure/cache/in-memory-resolution-cache.js';
import { HttpModelRegistryClient } from './infrastructure/clients/http-model-registry.client.js';
import { HttpInferenceClient } from './infrastructure/clients/http-inference.client.js';
import { HttpMemoryClient } from './infrastructure/clients/http-memory.client.js';
import { InMemoryMemoryClient } from './infrastructure/clients/in-memory-memory.client.js';
import { JsonLogger } from './infrastructure/logging/logger.js';
import { ChatController } from './interfaces/http/controllers/chat.controller.js';
import { ResourcesController } from './interfaces/http/controllers/resources.controller.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface AiOrchestratorDependencies {
  readonly config?: AiOrchestratorConfig | undefined;
  readonly modelRegistry?: ModelRegistryPort | undefined;
  readonly inference?: InferencePort | undefined;
  readonly memory?: MemoryPort | undefined;
  readonly resolutionCache?: ResolutionCachePort | undefined;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
}

export class AiOrchestratorService {
  private readonly config: AiOrchestratorConfig;
  private readonly modelRegistry: ModelRegistryPort;
  private readonly inference: InferencePort;
  private readonly memory: MemoryPort;
  private readonly resolutionCache: ResolutionCachePort;
  private readonly logger: JsonLogger;
  private readonly coordinateUseCase: CoordinateChatTurnUseCase;
  private readonly chatController: ChatController;
  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: AiOrchestratorDependencies = {}) {
    this.config = dependencies.config ?? loadAiOrchestratorConfig();

    this.modelRegistry =
      dependencies.modelRegistry ??
      new HttpModelRegistryClient({
        baseUrl: this.config.modelRegistryBaseUrl,
        internalToken: this.config.modelRegistryInternalToken,
      });

    this.inference =
      dependencies.inference ??
      new HttpInferenceClient({
        baseUrl: this.config.inferenceBaseUrl,
        internalToken: this.config.inferenceInternalToken,
      });

    if (dependencies.memory) {
      this.memory = dependencies.memory;
    } else if (this.config.memoryBaseUrl === 'in-memory' || this.config.environment === 'test') {
      this.memory = new InMemoryMemoryClient();
    } else {
      this.memory = new HttpMemoryClient({
        baseUrl: this.config.memoryBaseUrl,
        internalToken: this.config.memoryInternalToken,
      });
    }

    this.resolutionCache =
      dependencies.resolutionCache ?? new InMemoryResolutionCache(this.config.cacheTtlSeconds);

    this.logger = new JsonLogger(
      this.config.serviceName,
      (this.config.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
    );

    this.coordinateUseCase = new CoordinateChatTurnUseCase({
      modelRegistry: this.modelRegistry,
      inference: this.inference,
      memory: this.memory,
      resolutionCache: this.resolutionCache,
      tracer: dependencies.tracer ?? new NoopAiTracer(),
      metrics: dependencies.metrics ?? new NoopAiMetricsRecorder(),
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      maxTimeoutMs: this.config.maxTimeoutMs,
      cacheTtlSeconds: this.config.cacheTtlSeconds,
      privacyPolicy: {
        exposeReasoning: this.config.exposeReasoningDefault,
        redactThinkingInLogs: true,
      },
    });

    this.chatController = new ChatController({
      coordinateChatTurnUseCase: this.coordinateUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });
  }

  public getCoordinateUseCase(): CoordinateChatTurnUseCase {
    return this.coordinateUseCase;
  }

  public getModelRegistry(): ModelRegistryPort {
    return this.modelRegistry;
  }

  public getInference(): InferencePort {
    return this.inference;
  }

  public getMemory(): MemoryPort {
    return this.memory;
  }

  public getResolutionCache(): ResolutionCachePort {
    return this.resolutionCache;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async start(): Promise<number> {
    const router = createHttpRouter({
      chatController: this.chatController,
      resourcesController: new ResourcesController(this.modelRegistry, this.memory),
      serviceName: this.config.serviceName,
      version: this.config.version,
      isReady: () => this.ready,
      getHealthChecks: async () => {
        const [registryOk, inferenceOk, memoryOk] = await Promise.all([
          this.modelRegistry.checkHealth().catch(() => false),
          this.inference.checkHealth().catch(() => false),
          this.memory.checkHealth().catch(() => false),
        ]);
        return {
          modelRegistry: registryOk ? 'ok' : 'failed',
          inference: inferenceOk ? 'ok' : 'failed',
          memory: memoryOk ? 'ok' : 'failed',
        };
      },
      allowedServiceIdentities: this.config.allowedServiceIdentities,
      internalToken: this.config.internalToken,
      environment: this.config.environment,
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
                code: 'INTERNAL_ORCHESTRATOR_ERROR',
                message: 'Unhandled server error',
              },
            }),
          );
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server?.listen(this.config.port, this.config.host, () => {
        this.ready = true;
        const address = this.server?.address();
        const actualPort =
          typeof address === 'object' && address !== null ? address.port : this.config.port;

        this.logger.info(
          `AI Orchestrator service started on ${this.config.host}:${actualPort} [${this.config.environment}]`,
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
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      const server = this.server;
      server.close(() => {
        this.logger.info('AI Orchestrator service stopped');
        this.server = null;
        resolve();
      });
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }
}
