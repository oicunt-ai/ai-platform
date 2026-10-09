import type { RetryPolicyConfig } from './domain/types.js';

export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface CircuitBreakerOptions {
  readonly failureThresholdPercentage: number;
  readonly slidingWindowSize: number;
  readonly cooldownPeriodMs: number;
}

export type RetryPolicyOptions = RetryPolicyConfig;

export interface ModelGatewayConfig {
  readonly serviceName: string;
  readonly environment: Environment;
  readonly port: number;
  readonly host: string;
  readonly version: string;
  readonly shutdownTimeoutMs: number;
  readonly enableTelemetry: boolean;
  readonly logLevel: string;
  readonly allowedServiceIdentities: readonly string[];
  readonly maxBodySizeBytes: number;
  readonly defaultTimeoutMs: number;
  readonly circuitBreaker: CircuitBreakerOptions;
  readonly retryPolicy: RetryPolicyOptions;
  readonly internalToken?: string | undefined;
  readonly rabbitmqUrl?: string | undefined;
  readonly usageExchange: string;
  readonly enableUsagePublishing?: boolean | undefined;
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

export function loadModelGatewayConfig(
  overrides?: Partial<ModelGatewayConfig>,
): ModelGatewayConfig {
  const env = overrides?.environment ?? resolveEnvironment(process.env['NODE_ENV']);
  const port = overrides?.port ?? Number.parseInt(process.env['PORT'] ?? '3002', 10);
  const host = overrides?.host ?? process.env['HOST'] ?? '0.0.0.0';
  const shutdownTimeoutMs =
    overrides?.shutdownTimeoutMs ??
    Number.parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '5000', 10);
  const enableTelemetry = overrides?.enableTelemetry ?? process.env['ENABLE_TELEMETRY'] === 'true';
  const logLevel =
    overrides?.logLevel ?? process.env['LOG_LEVEL'] ?? (env === 'test' ? 'silent' : 'info');

  const allowedServices =
    overrides?.allowedServiceIdentities ??
    (process.env['ALLOWED_SERVICE_IDENTITIES']
      ? process.env['ALLOWED_SERVICE_IDENTITIES'].split(',').map((s) => s.trim())
      : ['inference', 'ai-orchestrator', 'ai-platform-admin']);

  const config: ModelGatewayConfig = {
    serviceName: overrides?.serviceName ?? 'model-gateway',
    environment: env,
    port,
    host,
    version: overrides?.version ?? '0.1.0',
    shutdownTimeoutMs,
    enableTelemetry,
    logLevel,
    allowedServiceIdentities: allowedServices,
    internalToken:
      overrides?.internalToken ??
      process.env['MODEL_GATEWAY_INTERNAL_TOKEN'] ??
      process.env['INTERNAL_SERVICE_TOKEN'] ??
      process.env['INTERNAL_SERVICE_SECRET'],
    rabbitmqUrl: overrides?.rabbitmqUrl ?? process.env['RABBITMQ_URL'],
    usageExchange:
      overrides?.usageExchange ?? process.env['USAGE_RABBITMQ_EXCHANGE'] ?? 'oicunt.usage',
    enableUsagePublishing:
      overrides?.enableUsagePublishing ??
      (env === 'production' || process.env['ENABLE_USAGE_PUBLISHING'] === 'true'),
    maxBodySizeBytes: overrides?.maxBodySizeBytes ?? 1048576,
    defaultTimeoutMs: overrides?.defaultTimeoutMs ?? 120000,
    circuitBreaker: {
      failureThresholdPercentage:
        overrides?.circuitBreaker?.failureThresholdPercentage ??
        Number.parseInt(process.env['CB_FAILURE_THRESHOLD_PCT'] ?? '50', 10),
      slidingWindowSize:
        overrides?.circuitBreaker?.slidingWindowSize ??
        Number.parseInt(process.env['CB_SLIDING_WINDOW_SIZE'] ?? '20', 10),
      cooldownPeriodMs:
        overrides?.circuitBreaker?.cooldownPeriodMs ??
        Number.parseInt(process.env['CB_COOLDOWN_PERIOD_MS'] ?? '30000', 10),
    },
    retryPolicy: {
      maxAttemptsPerTarget:
        overrides?.retryPolicy?.maxAttemptsPerTarget ??
        Number.parseInt(process.env['MAX_ATTEMPTS_PER_TARGET'] ?? '3', 10),
      maxFallbackAttempts:
        overrides?.retryPolicy?.maxFallbackAttempts ??
        Number.parseInt(process.env['MAX_FALLBACK_ATTEMPTS'] ?? '2', 10),
      maxTotalExecutionAttempts:
        overrides?.retryPolicy?.maxTotalExecutionAttempts ??
        Number.parseInt(process.env['MAX_TOTAL_EXECUTION_ATTEMPTS'] ?? '4', 10),
      initialBackoffDelayMs:
        overrides?.retryPolicy?.initialBackoffDelayMs ??
        Number.parseInt(process.env['INITIAL_BACKOFF_DELAY_MS'] ?? '500', 10),
      maxBackoffDelayMs:
        overrides?.retryPolicy?.maxBackoffDelayMs ??
        Number.parseInt(process.env['MAX_BACKOFF_DELAY_MS'] ?? '8000', 10),
      backoffMultiplier: overrides?.retryPolicy?.backoffMultiplier ?? 2.0,
    },
  };

  if (env === 'production') {
    const missing = [
      ['MODEL_GATEWAY_INTERNAL_TOKEN', config.internalToken],
      ['RABBITMQ_URL', config.rabbitmqUrl],
    ].filter(([, value]) => !value || value.trim().length === 0);
    if (missing.length > 0) {
      throw new Error(
        `Model Gateway production configuration is incomplete: ${missing.map(([name]) => name).join(', ')}`,
      );
    }
  }

  return config;
}
