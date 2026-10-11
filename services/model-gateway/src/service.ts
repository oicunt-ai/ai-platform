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
import type { MeteringCapturePort } from './application/ports/metering-capture.port.js';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import { evaluateMeteringHealth } from './application/metering-health.js';
import { RabbitMqUsagePublisher } from './infrastructure/usage/rabbitmq-usage.publisher.js';
import { ManagedAmqpConnection } from './infrastructure/usage/managed-amqp-connection.js';
import { OutboxDatabasePool } from './infrastructure/database/connection.js';
import { verifyMeteringOutboxCompatibility } from './infrastructure/database/schema-compat.js';
import { PostgresMeteringOutboxStore } from './infrastructure/usage/outbox/outbox-store.js';
import { OutboxDrainer } from './infrastructure/usage/outbox/outbox-drainer.js';

export interface MeteringHealthSnapshot {
  readonly enabled: boolean;
  readonly captureHealthy: boolean;
  readonly publisherReady: boolean;
  readonly pending: number;
  readonly oldestPendingAgeSec: number | null;
  readonly failed: number;
  readonly publishedTotal: number;
  readonly retriedTotal: number;
  readonly quarantinedTotal: number;
  readonly lastCycleAt: string | null;
}

/** Structural sender detection: anything with a send() can drain the outbox. */
function isOutboxSender(
  candidate: unknown,
): candidate is UsagePublisherPort & { send(event: UsageEvent): Promise<void> } {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { send?: unknown }).send === 'function'
  );
}

export interface ModelGatewayDependencies {
  readonly config?: ModelGatewayConfig | undefined;
  readonly adapterRegistry?: AdapterRegistryPort | undefined;
  readonly circuitBreakerStore?: CircuitBreakerStorePort | undefined;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
  readonly usagePublisher?: UsagePublisherPort | undefined;
  /** Injected durable capture (tests and P2 wiring). Overrides outbox construction. */
  readonly meteringCapture?: MeteringCapturePort | undefined;
  /** Injected outbox pool (tests). Avoids opening a real connection. */
  readonly outboxPool?: OutboxDatabasePool | undefined;
  /** Injected drainer (tests). Overrides drainer construction. */
  readonly meteringDrainer?: OutboxDrainer | undefined;
}

export class ModelGatewayService {
  private readonly config: ModelGatewayConfig;
  private readonly adapterRegistry: AdapterRegistryPort;
  private readonly circuitBreakerStore: CircuitBreakerStorePort;
  private readonly logger: JsonLogger;
  private readonly dispatchUseCase: DispatchModelUseCase;
  private readonly dispatchController: DispatchController;
  private readonly usagePublisher?: UsagePublisherPort | undefined;
  private readonly meteringCapture?: MeteringCapturePort | undefined;
  private readonly outboxPool?: OutboxDatabasePool | undefined;
  private readonly meteringDrainer?: OutboxDrainer | undefined;
  private server: Server | null = null;
  private ready = false;
  // Metering health snapshot (metering enabled only; booleans/counts, never secrets).
  private captureHealthy = true;
  private backlogPending = 0;
  private backlogOldestAgeSec: number | null = null;
  private backlogFailed = 0;
  private meteringPublishedTotal = 0;
  private meteringRetriedTotal = 0;
  private meteringQuarantinedTotal = 0;
  private lastMeteringCycleAt: string | null = null;
  private captureMonitorTimer: NodeJS.Timeout | null = null;

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
        ? new RabbitMqUsagePublisher({
            url: this.config.rabbitmqUrl,
            exchange: this.config.usageExchange,
            options: {
              confirmTimeoutMs: this.config.meteringPublisher.confirmTimeoutMs,
            },
            connection: new ManagedAmqpConnection({
              url: this.config.rabbitmqUrl,
              exchange: this.config.usageExchange,
              options: {
                initialReconnectDelayMs: this.config.meteringPublisher.reconnectInitialMs,
                maxReconnectDelayMs: this.config.meteringPublisher.reconnectMaxMs,
              },
              onLog: (level, message) => {
                if (level === 'error') this.logger.error(message);
                else if (level === 'warn') this.logger.warn(message);
                else this.logger.info(message);
              },
            }),
          })
        : undefined);

    // Durable metering capture (P1 outbox). Constructed ONLY when metering
    // is explicitly enabled: a disabled gateway opens no database
    // connection and its execution behavior is unchanged.
    if (dependencies.meteringCapture !== undefined) {
      this.meteringCapture = dependencies.meteringCapture;
    } else if (this.config.enableUsagePublishing) {
      this.outboxPool =
        dependencies.outboxPool ??
        new OutboxDatabasePool({
          host: this.config.outboxDatabase.host,
          port: this.config.outboxDatabase.port,
          database: this.config.outboxDatabase.database,
          user: this.config.outboxDatabase.user,
          password: this.config.outboxDatabase.password,
        });
      this.meteringCapture = new PostgresMeteringOutboxStore(this.outboxPool);
    }

    // Outbox drainer (P2 delivery). Wired ONLY when a sender-capable
    // publisher is available: capture always commits before publication,
    // and the drainer deletes a row only after confirmed, routable delivery.
    // Without a sender the gateway runs capture-only (events accumulate
    // durably) and says so loudly instead of delivering half-safely.
    if (dependencies.meteringDrainer !== undefined) {
      this.meteringDrainer = dependencies.meteringDrainer;
    } else if (
      this.meteringCapture instanceof PostgresMeteringOutboxStore &&
      isOutboxSender(this.usagePublisher)
    ) {
      const store = this.meteringCapture;
      this.meteringDrainer = new OutboxDrainer({
        store,
        sender: this.usagePublisher,
        options: {
          batchSize: this.config.meteringDrainer.batchSize,
          concurrency: this.config.meteringDrainer.concurrency,
          maxAttempts: this.config.meteringDrainer.maxAttempts,
          baseRetryDelayMs: this.config.meteringDrainer.baseRetryDelayMs,
          maxRetryDelayMs: this.config.meteringDrainer.maxRetryDelayMs,
          leaseMs: this.config.meteringDrainer.leaseMs,
          pollIntervalMs: this.config.meteringDrainer.pollIntervalMs,
        },
        metrics: {
          onPublished: () => {
            this.meteringPublishedTotal += 1;
          },
          onRetryScheduled: () => {
            this.meteringRetriedTotal += 1;
          },
          onQuarantined: () => {
            this.meteringQuarantinedTotal += 1;
          },
          onLeasesRecovered: () => undefined,
          setPending: (count) => {
            this.backlogPending = count;
            this.lastMeteringCycleAt = new Date().toISOString();
          },
          setOldestPendingAgeSec: (seconds) => {
            this.backlogOldestAgeSec = seconds;
          },
        },
        logger: this.logger,
      });
    } else if (this.meteringCapture !== undefined) {
      this.logger.warn(
        'Metering capture enabled without a broker publisher; captured events accumulate durably until delivery is configured',
      );
    }

    this.dispatchUseCase = new DispatchModelUseCase({
      adapterRegistry: this.adapterRegistry,
      circuitBreakerStore: this.circuitBreakerStore,
      tracer: dependencies.tracer ?? new NoopAiTracer(),
      metrics: dependencies.metrics ?? new NoopAiMetricsRecorder(),
      retryPolicy: this.config.retryPolicy,
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      meteringCapture: this.meteringCapture,
      meteringCaptureTimeoutMs: this.config.meteringCaptureTimeoutMs,
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

  /** Durable metering capture, or undefined when metering is disabled. */
  public getMeteringCapture(): MeteringCapturePort | undefined {
    return this.meteringCapture;
  }

  /** Point-in-time metering health: booleans and counts only, never secrets. */
  public getMeteringHealth(): MeteringHealthSnapshot {
    return {
      enabled: this.meteringCapture !== undefined,
      captureHealthy: this.captureHealthy,
      publisherReady: this.usagePublisher?.isReady() ?? false,
      pending: this.backlogPending,
      oldestPendingAgeSec: this.backlogOldestAgeSec,
      failed: this.backlogFailed,
      publishedTotal: this.meteringPublishedTotal,
      retriedTotal: this.meteringRetriedTotal,
      quarantinedTotal: this.meteringQuarantinedTotal,
      lastCycleAt: this.lastMeteringCycleAt,
    };
  }

  private resolveMeteringReady(inferenceReady: boolean): boolean {
    return evaluateMeteringHealth({
      inferenceReady,
      meteringEnabled: this.meteringCapture !== undefined,
      captureHealthy: this.captureHealthy,
      publisherReady: this.usagePublisher?.isReady() ?? false,
      backlog: {
        pending: this.backlogPending,
        oldestPendingAgeSec: this.backlogOldestAgeSec,
        failed: this.backlogFailed,
      },
    }).ready;
  }

  private resolveMeteringChecks(): Record<string, 'ok' | 'failed'> | undefined {
    if (this.meteringCapture === undefined) {
      return undefined;
    }
    const { checks } = evaluateMeteringHealth({
      inferenceReady: true,
      meteringEnabled: true,
      captureHealthy: this.captureHealthy,
      publisherReady: this.usagePublisher?.isReady() ?? false,
      backlog: {
        pending: this.backlogPending,
        oldestPendingAgeSec: this.backlogOldestAgeSec,
        failed: this.backlogFailed,
      },
    });
    return { ...checks };
  }

  /**
   * Background capture-availability probe. Refreshes capture health and
   * backlog depth while metering is enabled; unref'd so it never holds the
   * process open. A dead capture store fails readiness closed (see
   * resolveMeteringReady) instead of serving unaccountable completions.
   */
  private startCaptureMonitor(): void {
    if (!this.outboxPool || this.captureMonitorTimer) {
      return;
    }
    const check = (): void => {
      void this.outboxPool!.ping().then((ok) => {
        if (this.captureHealthy && !ok) {
          this.logger.error('Metering outbox capture store unreachable; failing readiness closed');
        } else if (!this.captureHealthy && ok) {
          this.logger.info('Metering outbox capture store reachable again');
        }
        this.captureHealthy = ok;
      });
      if (this.meteringCapture instanceof PostgresMeteringOutboxStore) {
        const store = this.meteringCapture;
        void store
          .getStats()
          .then((stats) => {
            this.backlogPending = stats.pending;
            this.backlogFailed = stats.failed;
            this.backlogOldestAgeSec =
              stats.oldestPendingCapturedAt === null
                ? null
                : Math.max(
                    0,
                    Math.floor((Date.now() - Date.parse(stats.oldestPendingCapturedAt)) / 1000),
                  );
            this.lastMeteringCycleAt = new Date().toISOString();
          })
          .catch(() => undefined);
      }
    };
    this.captureMonitorTimer = setInterval(check, this.config.meteringCaptureCheckIntervalMs);
    this.captureMonitorTimer.unref?.();
  }

  private stopCaptureMonitor(): void {
    if (this.captureMonitorTimer) {
      clearInterval(this.captureMonitorTimer);
      this.captureMonitorTimer = null;
    }
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async start(): Promise<number> {
    // Explicit-migration safety: when durable metering is enabled, startup
    // verifies the outbox schema read-only and refuses to boot on mismatch.
    // Migrations run ONLY through the standalone migrate entrypoint; no DDL
    // is ever issued here.
    if (this.meteringCapture instanceof PostgresMeteringOutboxStore && this.outboxPool) {
      const report = await verifyMeteringOutboxCompatibility(this.outboxPool);
      if (!report.compatible) {
        throw new Error(
          `[model-gateway] refusing to start with an unverifiable metering outbox schema: ${report.problems.join('; ')}`,
        );
      }
    }
    await this.usagePublisher?.start();
    // Delivery runs in the background once connectivity exists; boot never
    // waits for the broker. Already-captured events drain when the
    // publisher connects.
    if (this.meteringDrainer) {
      this.logger.info('Starting metering outbox drainer');
      void this.meteringDrainer.start();
    }
    this.startCaptureMonitor();
    // Detail for /readyz only when metering is enabled; disabled gateways
    // keep the legacy response shape exactly.
    const meteringChecks =
      this.meteringCapture === undefined ? undefined : () => this.resolveMeteringChecks() ?? {};
    const router = createHttpRouter({
      dispatchController: this.dispatchController,
      serviceName: this.config.serviceName,
      version: this.config.version,
      isReady: () => {
        const inferenceReady = this.ready && this.adapterRegistry.getAllAdapters().length > 0;
        if (this.meteringCapture === undefined) {
          // Metering disabled: legacy behavior preserved exactly.
          return inferenceReady && (this.usagePublisher?.isReady() ?? true);
        }
        // Metering enabled: inference readiness is independent of the
        // broker — only a dead durable capture store fails closed.
        return this.resolveMeteringReady(inferenceReady);
      },
      meteringChecks,
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
    this.stopCaptureMonitor();
    // Shutdown order: stop claiming new work first, let in-flight
    // deliveries settle (bounded), then release transport and storage.
    // A send rejected by publisher close stays recoverable in the outbox.
    await this.meteringDrainer?.stop().catch(() => {
      // Best effort during shutdown.
    });
    await this.usagePublisher?.close().catch(() => {
      // Best effort during shutdown.
    });
    await this.outboxPool?.close().catch(() => {
      // Best effort during shutdown.
    });
    if (!this.server) {
      return;
    }

    const server = this.server;

    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }
}
