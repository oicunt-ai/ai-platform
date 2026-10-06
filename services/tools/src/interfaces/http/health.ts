import type { ServerResponse } from 'node:http';
import type { DatabasePool } from '../../infrastructure/database/connection.js';

export async function handleLiveness(res: ServerResponse): Promise<void> {
  const payload = JSON.stringify({ status: 'ok', check: 'liveness', service: 'tools' });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function handleReadiness(
  res: ServerResponse,
  dbPool: DatabasePool | null,
): Promise<void> {
  let dbOk = true;
  if (dbPool) {
    dbOk = await dbPool.ping();
  }

  const isReady = dbOk;
  const statusCode = isReady ? 200 : 503;
  const payload = JSON.stringify({
    status: isReady ? 'ok' : 'degraded',
    check: 'readiness',
    service: 'tools',
    components: {
      database: dbOk ? 'healthy' : 'unhealthy',
    },
  });

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
