import type { IncomingMessage, ServerResponse } from 'node:http';

export interface HealthCheckOptions {
  readonly isReady: () => boolean;
  readonly checkDbReady?: (() => Promise<boolean>) | undefined;
  readonly checkVectorStoreReady?: (() => Promise<boolean>) | undefined;
  readonly checkObjectStorageReady?: (() => Promise<boolean>) | undefined;
}

export function handleLiveness(_req: IncomingMessage, res: ServerResponse): void {
  const body = JSON.stringify({ status: 'alive' });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function handleReadiness(
  _req: IncomingMessage,
  res: ServerResponse,
  options: HealthCheckOptions,
): Promise<void> {
  const serviceReady = options.isReady();

  let dbReady = true;
  if (options.checkDbReady) {
    try {
      dbReady = await options.checkDbReady();
    } catch {
      dbReady = false;
    }
  }

  let vectorReady = true;
  if (options.checkVectorStoreReady) {
    try {
      vectorReady = await options.checkVectorStoreReady();
    } catch {
      vectorReady = false;
    }
  }

  let storageReady = true;
  if (options.checkObjectStorageReady) {
    try {
      storageReady = await options.checkObjectStorageReady();
    } catch {
      storageReady = false;
    }
  }

  const allReady = serviceReady && dbReady && vectorReady && storageReady;

  if (allReady) {
    const body = JSON.stringify({
      status: 'ready',
      database: dbReady ? 'connected' : 'disconnected',
      vectorStore: vectorReady ? 'connected' : 'disconnected',
      objectStorage: storageReady ? 'connected' : 'disconnected',
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  } else {
    const body = JSON.stringify({
      status: 'not_ready',
      serviceReady,
      database: dbReady ? 'connected' : 'disconnected',
      vectorStore: vectorReady ? 'connected' : 'disconnected',
      objectStorage: storageReady ? 'connected' : 'disconnected',
    });
    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}
