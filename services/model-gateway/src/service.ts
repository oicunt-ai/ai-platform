import { createServer, type Server } from 'node:http';
import { loadModelGatewayConfig, type ModelGatewayConfig } from './config.js';
import type { AdapterRegistryPort } from './application/ports/adapter-registry.port.js';
import type { CircuitBreakerStorePort } from './application/ports/circuit-breaker-store.port.js';
import { InMemoryAdapterRegistry } from './infrastructure/adapters/in-memory-adapter-registry.js';
import { GroqProviderAdapter } from './infrastructure/adapters/groq/index.js';
import { InMemoryCircuitBreakerStore } from './infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import { JsonLogger } from './infrastructure/logging/logger.js';
import { DispatchModelUseCase } from './application/use-cases/dispatch-model.use-case.js';
import { DispatchController } from './interfaces/http/controllers/dispatch.controller.js';
import { createHttpRouter } from './interfaces/http/router.js';
import type { AiMetricsRecorder, AiTracer } from '@oicunt-ai/observability';
import { NoopAiMetricsRecorder, NoopAiTracer } from '@oicunt-ai/observability';
import type { UsagePublisherPort } from './application/ports/usage-publisher.port.js';
import { RabbitMqUsagePublisher } from './infrastructure/usage/rabbitmq-usage.publisher.js';

export interface ModelGatewayDependencies {
  readonly config?: ModelGatewayConfig | undefined;
  readonly adapterRegistry?: AdapterRegistryPort | undefined;
  readonly circuitBreakerStore?: CircuitBreakerStorePort | undefined;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
  readonly usagePublisher?: UsagePublisherPort | undefined;
}

export class ModelGatewayService {
  private readonly config: ModelGatewayConfig;
  private readonly adapterRegistry: AdapterRegistryPort;
  private readonly circuitBreakerStore: CircuitBreakerStorePort;
  private readonly logger: JsonLogger;
  private readonly dispatchUseCase: DispatchModelUseCase;
  private readonly dispatchController: DispatchController;
  private readonly usagePublisher?: UsagePublisherPort | undefined;
  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: ModelGatewayDependencies = {}) {
    this.config = dependencies.config ?? loadModelGatewayConfig();

    this.adapterRegistry = dependencies.adapterRegistry ?? new InMemoryAdapterRegistry();
    if (!dependencies.adapterRegistry) {
      // Register the Groq adapter only when credentials are configured.
      // Without GROQ_API_KEY the gateway honestly reports not-ready.
      const groqApiKey = this.config.groq?.apiKey;
      if (groqApiKey && groqApiKey.trim().length > 0) {
        this.adapterRegistry.register(
          new GroqProviderAdapter({
            apiKey: groqApiKey,
            baseUrl: this.config.groq?.baseUrl,
          }),
        );
      }
    }
    this.circuitBreakerStore =
      dependencies.circuitBreakerStore ??
      new InMemoryCircuitBreakerStore(this.config.circuitBreaker);

    this.logger = new JsonLogger(
      this.config.serviceName,
      (this.config.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
    );
    this.usagePublisher =
      dependencies.usagePublisher ??
      (this.config.enableUsagePublishing && this.config.rabbitmqUrl
        ? new RabbitMqUsagePublisher(this.config.rabbitmqUrl, this.config.usageExchange)
        : undefined);

    this.dispatchUseCase = new DispatchModelUseCase({
      adapterRegistry: this.adapterRegistry,
      circuitBreakerStore: this.circuitBreakerStore,
      tracer: dependencies.tracer ?? new NoopAiTracer(),
      metrics: dependencies.metrics ?? new NoopAiMetricsRecorder(),
      retryPolicy: this.config.retryPolicy,
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      usagePublisher: this.usagePublisher,
    });

    this.dispatchController = new DispatchController({
      dispatchUseCase: this.dispatchUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });
  }

  public getDispatchUseCase(): DispatchModelUseCase {
    return this.dispatchUseCase;
  }

  public getAdapterRegistry(): AdapterRegistryPort {
    return this.adapterRegistry;
  }

  public getCircuitBreakerStore(): CircuitBreakerStorePort {
    return this.circuitBreakerStore;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async start(): Promise<number> {
    await this.usagePublisher?.start();
    const router = createHttpRouter({
      dispatchController: this.dispatchController,
      serviceName: this.config.serviceName,
      version: this.config.version,
      isReady: () =>
        this.ready &&
        this.adapterRegistry.getAllAdapters().length > 0 &&
        (this.usagePublisher?.isReady() ?? true),
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
                code: 'INTERNAL_GATEWAY_ERROR',
                message: 'Unhandled server error',
              },
            }),
          );
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        const address = this.server!.address();
        const boundPort =
          typeof address === 'object' && address !== null ? address.port : this.config.port;

        this.ready = true;
        this.logger.info(`Model Gateway service running on port ${boundPort}`, {
          port: boundPort,
          env: this.config.environment,
        });
        resolve(boundPort);
      });

      this.server!.on('error', (err) => {
        this.ready = false;
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    this.ready = false;
    if (!this.server) {
      await this.usagePublisher?.close();
      return;
    }

    const server = this.server;

    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          void Promise.resolve(this.usagePublisher?.close()).then(resolve, reject);
        }
      });
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }
}
