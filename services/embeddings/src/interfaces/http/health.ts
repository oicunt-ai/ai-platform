import type { ServerResponse } from 'node:http';
import type { ModelRegistryPort } from '../../application/ports/model-registry.port.js';
import type { ModelGatewayPort } from '../../application/ports/model-gateway.port.js';

export function handleLiveness(res: ServerResponse): void {
  const body = JSON.stringify({
    status: 'ok',
    service: 'embeddings',
    timestamp: new Date().toISOString(),
  });

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function handleReadiness(
  res: ServerResponse,
  registryClient: ModelRegistryPort,
  gatewayClient: ModelGatewayPort,
  signal?: AbortSignal,
): Promise<void> {
  let registryHealthy = true;
  let gatewayHealthy = true;

  if (registryClient.checkHealth) {
    try {
      registryHealthy = await registryClient.checkHealth(signal);
    } catch {
      registryHealthy = false;
    }
  }

  if (gatewayClient.checkHealth) {
    try {
      gatewayHealthy = await gatewayClient.checkHealth(signal);
    } catch {
      gatewayHealthy = false;
    }
  }

  const isReady = registryHealthy && gatewayHealthy;
  const statusCode = isReady ? 200 : 503;

  const body = JSON.stringify({
    status: isReady ? 'ready' : 'not_ready',
    dependencies: {
      modelRegistry: registryHealthy,
      modelGateway: gatewayHealthy,
    },
    timestamp: new Date().toISOString(),
  });

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
