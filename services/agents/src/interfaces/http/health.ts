import type { ServerResponse } from 'node:http';
import type { DatabasePool } from '../../infrastructure/database/connection.js';
import type { AgentQueuePort } from '../../application/ports/agent-queue.port.js';

export async function handleLiveness(res: ServerResponse): Promise<void> {
  const payload = JSON.stringify({ status: 'ok', check: 'liveness', service: 'agents' });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function handleReadiness(
  res: ServerResponse,
  dbPool: DatabasePool | null,
  queue?: AgentQueuePort | null,
): Promise<void> {
  let dbOk = true;
  if (dbPool) {
    dbOk = await dbPool.ping();
  }

  let queueOk = true;
  if (queue && typeof queue.checkHealth === 'function') {
    queueOk = await queue.checkHealth();
  }

  const isReady = dbOk && queueOk;
  const statusCode = isReady ? 200 : 503;
  const payload = JSON.stringify({
    status: isReady ? 'ok' : 'degraded',
    check: 'readiness',
    service: 'agents',
    components: {
      database: dbOk ? 'healthy' : 'unhealthy',
      queue: queueOk ? 'healthy' : 'unhealthy',
    },
  });

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
