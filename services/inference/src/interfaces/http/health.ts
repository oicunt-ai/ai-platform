import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModelGatewayPort } from '../../application/ports/model-gateway.port.js';

export interface HealthCheckOptions {
  readonly modelGateway: ModelGatewayPort;
  readonly isReady: () => boolean;
}

export function handleLiveness(_req: IncomingMessage, res: ServerResponse): void {
  const body = JSON.stringify({ status: 'ok', service: 'inference' });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function handleReadiness(
  _req: IncomingMessage,
  res: ServerResponse,
  options: HealthCheckOptions,
): Promise<void> {
  if (!options.isReady()) {
    const body = JSON.stringify({
      status: 'not_ready',
      service: 'inference',
      reason: 'Service initializing',
    });
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  const gatewayHealthy = await options.modelGateway.checkHealth();
  if (!gatewayHealthy) {
    const body = JSON.stringify({
      status: 'degraded',
      service: 'inference',
      dependencies: {
        modelGateway: 'unhealthy',
      },
    });
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  const body = JSON.stringify({
    status: 'ready',
    service: 'inference',
    dependencies: {
      modelGateway: 'healthy',
    },
  });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
