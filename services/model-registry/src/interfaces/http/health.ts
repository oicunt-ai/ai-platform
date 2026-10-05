import type { ServerResponse } from 'node:http';

export interface HealthStatusPayload {
  readonly status: 'alive' | 'ready' | 'not_ready';
  readonly serviceName: string;
  readonly version: string;
  readonly timestamp: string;
  readonly checks?: Record<string, 'ok' | 'failed'> | undefined;
}

export function sendLivenessResponse(
  res: ServerResponse,
  serviceName: string,
  version: string,
): void {
  const payload = {
    success: true,
    data: {
      status: 'alive' as const,
      serviceName,
      version,
      timestamp: new Date().toISOString(),
    },
  };

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

export function sendReadinessResponse(
  res: ServerResponse,
  isReady: boolean,
  serviceName: string,
  version: string,
  checks?: Record<string, 'ok' | 'failed'>,
): void {
  if (isReady) {
    const payload = {
      success: true,
      data: {
        status: 'ready' as const,
        serviceName,
        version,
        timestamp: new Date().toISOString(),
        checks,
      },
    };

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(payload));
  } else {
    const payload = {
      success: false,
      error: {
        code: 'SERVICE_NOT_READY',
        message: 'The Model Registry service is initializing or dependencies are not reachable',
      },
      meta: {
        timestamp: new Date().toISOString(),
        checks,
      },
    };

    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(payload));
  }
}
