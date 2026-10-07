import type { ServerResponse } from 'node:http';
import type { DatabasePool } from '../../infrastructure/database/connection.js';

export async function handleLiveness(res: ServerResponse): Promise<void> {
  const body = JSON.stringify({
    status: 'ok',
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
  dbPool?: DatabasePool | null,
): Promise<void> {
  let dbOk = true;
  if (dbPool) {
    dbOk = await dbPool.ping();
  }

  const isReady = dbOk;
  const statusCode = isReady ? 200 : 503;

  const body = JSON.stringify({
    status: isReady ? 'ok' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk ? 'ok' : 'unhealthy',
    },
  });

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
