export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface AiServiceConfig {
  readonly serviceName: string;
  readonly environment: Environment;
  readonly port: number;
  readonly host: string;
  readonly version: string;
  readonly shutdownTimeoutMs: number;
  readonly enableTelemetry: boolean;
  readonly logLevel: string;
}

export function resolveEnvironment(raw?: string): Environment {
  const normalized = raw?.toLowerCase().trim();
  switch (normalized) {
    case 'production':
    case 'prod':
      return 'production';
    case 'staging':
    case 'stage':
      return 'staging';
    case 'test':
      return 'test';
    default:
      return 'development';
  }
}

export function loadAiServiceConfig(overrides?: Partial<AiServiceConfig>): AiServiceConfig {
  const env = overrides?.environment ?? resolveEnvironment(process.env['NODE_ENV']);
  const port = overrides?.port ?? Number.parseInt(process.env['PORT'] ?? '3000', 10);
  const host = overrides?.host ?? process.env['HOST'] ?? '0.0.0.0';
  const shutdownTimeoutMs =
    overrides?.shutdownTimeoutMs ??
    Number.parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '5000', 10);
  const enableTelemetry = overrides?.enableTelemetry ?? process.env['ENABLE_TELEMETRY'] !== 'false';
  const logLevel = overrides?.logLevel ?? process.env['LOG_LEVEL'] ?? 'info';

  const config: AiServiceConfig = {
    serviceName: overrides?.serviceName ?? 'ai-service-template',
    environment: env,
    port: Number.isNaN(port) ? 3000 : port,
    host,
    version: overrides?.version ?? '0.1.0',
    shutdownTimeoutMs: Number.isNaN(shutdownTimeoutMs) ? 5000 : shutdownTimeoutMs,
    enableTelemetry,
    logLevel,
  };

  // Fail-fast validation
  if (config.port < 0 || config.port > 65535) {
    throw new Error(`Invalid port configuration: ${config.port}`);
  }

  return Object.freeze(config);
}
