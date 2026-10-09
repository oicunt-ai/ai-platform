import { createServer, type Server } from 'node:http';
import type { AiMetricsRecorder, AiTracer } from '@oicunt-ai/observability';
import { NoopAiMetricsRecorder, NoopAiTracer } from '@oicunt-ai/observability';
import { loadInferenceConfig, type InferenceConfig } from './config.js';
import type { ModelGatewayPort } from './application/ports/model-gateway.port.js';
import type { InferenceHookPort } from './application/ports/inference-hook.port.js';
import { ExecuteInferenceUseCase } from './application/use-cases/execute-inference.use-case.js';
import { HttpModelGatewayClient } from './infrastructure/clients/http-model-gateway.client.js';
import { NoopInferenceHook } from './infrastructure/hooks/noop-inference-hook.js';
import { JsonLogger } from './infrastructure/logging/logger.js';
import { InferenceController } from './interfaces/http/controllers/inference.controller.js';
import { createHttpRouter } from './interfaces/http/router.js';

export interface InferenceServiceDependencies {
  readonly config?: InferenceConfig | undefined;
  readonly modelGateway?: ModelGatewayPort | undefined;
  readonly hook?: InferenceHookPort | undefined;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
}

export class InferenceService {
  private readonly config: InferenceConfig;
  private readonly modelGateway: ModelGatewayPort;
  private readonly hook: InferenceHookPort;
  private readonly logger: JsonLogger;
  private readonly executeUseCase: ExecuteInferenceUseCase;
  private readonly inferenceController: InferenceController;
  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: InferenceServiceDependencies = {}) {
    this.config = dependencies.config ?? loadInferenceConfig();

    this.modelGateway =
      dependencies.modelGateway ??
      new HttpModelGatewayClient({
        baseUrl: this.config.modelGatewayBaseUrl,
        internalToken: this.config.modelGatewayInternalToken,
      });

    this.hook = dependencies.hook ?? new NoopInferenceHook();

    this.logger = new JsonLogger(
      this.config.serviceName,
      (this.config.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
    );

    this.executeUseCase = new ExecuteInferenceUseCase({
      modelGateway: this.modelGateway,
      hook: this.hook,
      tracer: dependencies.tracer ?? new NoopAiTracer(),
      metrics: dependencies.metrics ?? new NoopAiMetricsRecorder(),
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      maxTimeoutMs: this.config.maxTimeoutMs,
      privacyPolicy: {
        exposeReasoning: this.config.exposeReasoningDefault,
        redactThinking: !this.config.exposeReasoningDefault,
        redactThinkingInLogs: true,
      },
    });

    this.inferenceController = new InferenceController({
      executeInferenceUseCase: this.executeUseCase,
      maxBodySizeBytes: this.config.maxBodySizeBytes,
    });
  }

  public getExecuteUseCase(): ExecuteInferenceUseCase {
    return this.executeUseCase;
  }

  public getModelGateway(): ModelGatewayPort {
    return this.modelGateway;
  }

  public getHook(): InferenceHookPort {
    return this.hook;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async start(): Promise<number> {
    const router = createHttpRouter({
      inferenceController: this.inferenceController,
      healthOptions: {
        modelGateway: this.modelGateway,
        isReady: () => this.ready,
      },
      internalToken: this.config.internalToken,
      allowedServiceIdentities: this.config.allowedServiceIdentities,
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
                code: 'INTERNAL_INFERENCE_ERROR',
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
          `Inference service started on ${this.config.host}:${actualPort} [${this.config.environment}]`,
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
        this.logger.info('Inference service stopped');
        this.server = null;
        resolve();
      });
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }
}
