import type { ServerResponse } from 'node:http';

export interface HealthStatusData {
  readonly status: 'alive' | 'ready' | 'not_ready';
  readonly serviceName: string;
  readonly version: string;
  readonly timestamp: string;
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
): void {
  if (isReady) {
    const payload = {
      success: true,
      data: {
        status: 'ready' as const,
        serviceName,
        version,
        timestamp: new Date().toISOString(),
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
        message: 'The AI service is initializing or dependencies are not reachable',
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(payload));
  }
}
