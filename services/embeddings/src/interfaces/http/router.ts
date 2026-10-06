import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModelRegistryPort } from '../../application/ports/model-registry.port.js';
import type { ModelGatewayPort } from '../../application/ports/model-gateway.port.js';
import { InvalidRequestError } from '../../domain/errors.js';
import { extractRequestContext } from './context.js';
import type { EmbeddingsController } from './controllers/embeddings.controller.js';
import { handleLiveness, handleReadiness } from './health.js';
import { sendErrorResponse } from './middleware.js';

export interface EmbeddingsRouterOptions {
  readonly controller: EmbeddingsController;
  readonly modelRegistryClient: ModelRegistryPort;
  readonly modelGatewayClient: ModelGatewayPort;
}

export class EmbeddingsRouter {
  private readonly controller: EmbeddingsController;
  private readonly registryClient: ModelRegistryPort;
  private readonly gatewayClient: ModelGatewayPort;

  constructor(options: EmbeddingsRouterOptions) {
    this.controller = options.controller;
    this.registryClient = options.modelRegistryClient;
    this.gatewayClient = options.modelGatewayClient;
  }

  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const context = extractRequestContext(req, res);
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase();

    try {
      // Health probes
      if (method === 'GET' && (pathname === '/health/liveness' || pathname === '/healthz')) {
        handleLiveness(res);
        return;
      }

      if (method === 'GET' && (pathname === '/health/readiness' || pathname === '/readyz')) {
        await handleReadiness(res, this.registryClient, this.gatewayClient, context.signal);
        return;
      }

      // Embeddings API
      if (method === 'POST' && pathname === '/internal/v1/embeddings/embed') {
        await this.controller.embed(req, res, context);
        return;
      }

      // Unmatched route
      throw new InvalidRequestError(`Route not found: ${method} ${pathname}`);
    } catch (err: unknown) {
      sendErrorResponse(res, err, context);
    }
  }
}
