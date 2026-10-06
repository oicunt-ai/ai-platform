import { createServer, type Server } from 'node:http';
import { loadEmbeddingsConfig, type EmbeddingsConfig } from './config.js';
import type { ModelRegistryPort } from './application/ports/model-registry.port.js';
import type { ModelGatewayPort } from './application/ports/model-gateway.port.js';
import { GenerateEmbeddingsUseCase } from './application/use-cases/generate-embeddings.use-case.js';
import { JsonLogger, type EmbeddingsLogger } from './infrastructure/logging/logger.js';
import { EmbeddingsMetrics } from './infrastructure/observability/metrics.js';
import {
  HttpModelRegistryClient,
  HttpModelGatewayClient,
  MockModelRegistryClient,
  MockModelGatewayClient,
} from './infrastructure/clients/index.js';
import { EmbeddingsController } from './interfaces/http/controllers/embeddings.controller.js';
import { EmbeddingsRouter } from './interfaces/http/router.js';

export interface EmbeddingsServiceDependencies {
  readonly config?: EmbeddingsConfig | undefined;
  readonly modelRegistryClient?: ModelRegistryPort | undefined;
  readonly modelGatewayClient?: ModelGatewayPort | undefined;
  readonly metrics?: EmbeddingsMetrics | undefined;
  readonly logger?: EmbeddingsLogger | undefined;
}

export class EmbeddingsService {
  private readonly config: EmbeddingsConfig;
  private readonly logger: EmbeddingsLogger;
  private readonly metrics: EmbeddingsMetrics;
  private readonly modelRegistryClient: ModelRegistryPort;
  private readonly modelGatewayClient: ModelGatewayPort;
  private readonly generateEmbeddingsUseCase: GenerateEmbeddingsUseCase;
  private readonly controller: EmbeddingsController;
  private readonly router: EmbeddingsRouter;

  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: EmbeddingsServiceDependencies = {}) {
    this.config = dependencies.config ?? loadEmbeddingsConfig();

    this.logger =
      dependencies.logger ??
      new JsonLogger(
        this.config.serviceName,
        (this.config.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
      );

    this.metrics = dependencies.metrics ?? new EmbeddingsMetrics();

    if (dependencies.modelRegistryClient) {
      this.modelRegistryClient = dependencies.modelRegistryClient;
    } else if (this.config.environment === 'test') {
      this.modelRegistryClient = new MockModelRegistryClient();
    } else {
      this.modelRegistryClient = new HttpModelRegistryClient({
        baseUrl: this.config.modelRegistryUrl,
        internalToken: this.config.internalToken,
        timeoutMs: this.config.downstreamTimeoutMs,
      });
    }

    if (dependencies.modelGatewayClient) {
      this.modelGatewayClient = dependencies.modelGatewayClient;
    } else if (this.config.environment === 'test') {
      this.modelGatewayClient = new MockModelGatewayClient();
    } else {
      this.modelGatewayClient = new HttpModelGatewayClient({
        baseUrl: this.config.modelGatewayUrl,
        internalToken: this.config.internalToken,
        timeoutMs: this.config.downstreamTimeoutMs,
      });
    }

    this.generateEmbeddingsUseCase = new GenerateEmbeddingsUseCase(
      this.modelRegistryClient,
      this.modelGatewayClient,
      {
        maxBatchSize: this.config.maxBatchSize,
        maxItemCharacters: this.config.maxItemCharacters,
      },
    );

    this.controller = new EmbeddingsController({
      useCase: this.generateEmbeddingsUseCase,
      logger: this.logger,
      metrics: this.metrics,
      internalToken: this.config.internalToken,
      maxBatchSize: this.config.maxBatchSize,
    });

    this.router = new EmbeddingsRouter({
      controller: this.controller,
      modelRegistryClient: this.modelRegistryClient,
      modelGatewayClient: this.modelGatewayClient,
    });
  }

  public getConfig(): EmbeddingsConfig {
    return this.config;
  }

  public getModelRegistryClient(): ModelRegistryPort {
    return this.modelRegistryClient;
  }

  public getModelGatewayClient(): ModelGatewayPort {
    return this.modelGatewayClient;
  }

  public getMetrics(): EmbeddingsMetrics {
    return this.metrics;
  }

  public getLogger(): EmbeddingsLogger {
    return this.logger;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public getServer(): Server | null {
    return this.server;
  }

  public async initialize(): Promise<void> {
    this.server = createServer((req, res) => {
      this.router.handleRequest(req, res).catch((err: unknown) => {
        this.logger.error('Unhandled request processing error', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'INTERNAL_EMBEDDING_ERROR',
                message: 'Unhandled server error',
                retryable: false,
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
          `Embeddings Service started on ${this.config.host}:${actualPort} [${this.config.environment}]`,
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
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        resolve();
      }, this.config.shutdownTimeoutMs);

      this.server.close((err) => {
        clearTimeout(timeout);
        this.server = null;
        if (err) {
          reject(err);
        } else {
          this.logger.info('Embeddings Service stopped');
          resolve();
        }
      });
    });
  }
}
