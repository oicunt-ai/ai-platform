import type { RetryPolicyConfig } from './domain/types.js';

export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface CircuitBreakerOptions {
  readonly failureThresholdPercentage: number;
  readonly slidingWindowSize: number;
  readonly cooldownPeriodMs: number;
}

export type RetryPolicyOptions = RetryPolicyConfig;

export interface GroqProviderConfig {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
}

export interface OutboxDatabaseOptions {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly database?: string | undefined;
  readonly user?: string | undefined;
  readonly password?: string | undefined;
}

export interface MeteringDrainerOptions {
  readonly batchSize?: number | undefined;
  readonly concurrency?: number | undefined;
  readonly maxAttempts?: number | undefined;
  readonly baseRetryDelayMs?: number | undefined;
  readonly maxRetryDelayMs?: number | undefined;
  readonly leaseMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export interface MeteringPublisherOptions {
  readonly confirmTimeoutMs?: number | undefined;
  readonly reconnectInitialMs?: number | undefined;
  readonly reconnectMaxMs?: number | undefined;
}

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
  readonly groq?: GroqProviderConfig | undefined;
  readonly internalToken?: string | undefined;
  readonly rabbitmqUrl?: string | undefined;
  readonly usageExchange: string;
  /**
   * Explicit deployment-controlled metering switch. Always resolved to a
   * concrete boolean: production requires an explicit 'true'/'false'
   * setting and fails startup otherwise; other environments default to
   * disabled. Never implied by NODE_ENV.
   */
  readonly enableUsagePublishing: boolean;
  /** PostgreSQL connection for the durable metering outbox (oicunt_ai). */
  readonly outboxDatabase: OutboxDatabaseOptions;
  /** Upper bound for a single durable capture INSERT. */
  readonly meteringCaptureTimeoutMs: number;
  /** Interval for the background capture-availability probe. */
  readonly meteringCaptureCheckIntervalMs: number;
  /** Outbox drainer tuning (delivery scheduling, leases, retries). */
  readonly meteringDrainer: MeteringDrainerOptions;
  /** Publisher tuning (confirms, reconnect backoff). */
  readonly meteringPublisher: MeteringPublisherOptions;
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

/**
 * Parses an explicit boolean feature switch. Returns undefined when unset;
 * throws on any other value so typos can neither silently enable nor
 * silently disable metering.
 */
export function parseExplicitSwitch(raw: string | undefined, name: string): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(
    `${name} must be explicitly 'true' or 'false' when set (received '${raw.trim()}')`,
  );
}

function resolveUsagePublishing(
  env: Environment,
  override: boolean | undefined,
  rawEnv: string | undefined,
): boolean {
  if (override !== undefined) {
    return override;
  }
  const parsed = parseExplicitSwitch(rawEnv, 'ENABLE_USAGE_PUBLISHING');
  if (parsed !== undefined) {
    return parsed;
  }
  if (env === 'production') {
    throw new Error(
      "ENABLE_USAGE_PUBLISHING must be explicitly 'true' or 'false' in production (no implicit activation)",
    );
  }
  return false;
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
    // Explicit deployment-controlled activation: publishing is never
    // implied by the environment. Production requires an explicit
    // true/false setting and fails startup without one; other
    // environments default to disabled.
    enableUsagePublishing: resolveUsagePublishing(
      env,
      overrides?.enableUsagePublishing,
      process.env['ENABLE_USAGE_PUBLISHING'],
    ),
    outboxDatabase: {
      host:
        overrides?.outboxDatabase?.host ??
        process.env['OUTBOX_DB_HOST'] ??
        process.env['DATABASE_HOST'] ??
        'localhost',
      port:
        overrides?.outboxDatabase?.port ??
        Number.parseInt(
          process.env['OUTBOX_DB_PORT'] ?? process.env['DATABASE_PORT'] ?? '5432',
          10,
        ),
      database:
        overrides?.outboxDatabase?.database ??
        process.env['OUTBOX_DB_NAME'] ??
        process.env['DATABASE_NAME'] ??
        'oicunt_ai',
      user:
        overrides?.outboxDatabase?.user ??
        process.env['OUTBOX_DB_USER'] ??
        process.env['DATABASE_USER'] ??
        'postgres',
      password:
        overrides?.outboxDatabase?.password ??
        process.env['OUTBOX_DB_PASSWORD'] ??
        process.env['DATABASE_PASSWORD'] ??
        '',
    },
    meteringCaptureTimeoutMs:
      overrides?.meteringCaptureTimeoutMs ??
      Number.parseInt(process.env['METERING_CAPTURE_TIMEOUT_MS'] ?? '2000', 10),
    meteringCaptureCheckIntervalMs:
      overrides?.meteringCaptureCheckIntervalMs ??
      Number.parseInt(process.env['METERING_CAPTURE_CHECK_INTERVAL_MS'] ?? '15000', 10),
    meteringDrainer: {
      batchSize:
        overrides?.meteringDrainer?.batchSize ??
        Number.parseInt(process.env['OUTBOX_DRAIN_BATCH_SIZE'] ?? '50', 10),
      concurrency:
        overrides?.meteringDrainer?.concurrency ??
        Number.parseInt(process.env['OUTBOX_DRAIN_CONCURRENCY'] ?? '5', 10),
      maxAttempts:
        overrides?.meteringDrainer?.maxAttempts ??
        Number.parseInt(process.env['OUTBOX_DRAIN_MAX_ATTEMPTS'] ?? '20', 10),
      baseRetryDelayMs:
        overrides?.meteringDrainer?.baseRetryDelayMs ??
        Number.parseInt(process.env['OUTBOX_DRAIN_BASE_DELAY_MS'] ?? '1000', 10),
      maxRetryDelayMs:
        overrides?.meteringDrainer?.maxRetryDelayMs ??
        Number.parseInt(process.env['OUTBOX_DRAIN_MAX_DELAY_MS'] ?? '300000', 10),
      leaseMs:
        overrides?.meteringDrainer?.leaseMs ??
        Number.parseInt(process.env['OUTBOX_DRAIN_LEASE_MS'] ?? '300000', 10),
      pollIntervalMs:
        overrides?.meteringDrainer?.pollIntervalMs ??
        Number.parseInt(process.env['OUTBOX_DRAIN_POLL_MS'] ?? '1000', 10),
    },
    meteringPublisher: {
      confirmTimeoutMs:
        overrides?.meteringPublisher?.confirmTimeoutMs ??
        Number.parseInt(process.env['METERING_PUBLISH_CONFIRM_TIMEOUT_MS'] ?? '10000', 10),
      reconnectInitialMs:
        overrides?.meteringPublisher?.reconnectInitialMs ??
        Number.parseInt(process.env['METERING_RECONNECT_INITIAL_MS'] ?? '1000', 10),
      reconnectMaxMs:
        overrides?.meteringPublisher?.reconnectMaxMs ??
        Number.parseInt(process.env['METERING_RECONNECT_MAX_MS'] ?? '30000', 10),
    },
    maxBodySizeBytes: overrides?.maxBodySizeBytes ?? 1048576,
    defaultTimeoutMs: overrides?.defaultTimeoutMs ?? 120000,
    groq: {
      apiKey: overrides?.groq?.apiKey ?? process.env['GROQ_API_KEY'],
      baseUrl:
        overrides?.groq?.baseUrl ??
        process.env['GROQ_BASE_URL'] ??
        'https://api.groq.com/openai/v1',
    },
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
      ...(config.enableUsagePublishing
        ? [
            ['RABBITMQ_URL', config.rabbitmqUrl],
            ['OUTBOX_DB_HOST (or DATABASE_HOST)', config.outboxDatabase.host],
            ['OUTBOX_DB_NAME (or DATABASE_NAME)', config.outboxDatabase.database],
            ['OUTBOX_DB_USER (or DATABASE_USER)', config.outboxDatabase.user],
          ]
        : []),
    ].filter(([, value]) => !value || value.trim().length === 0);
    if (missing.length > 0) {
      throw new Error(
        `Model Gateway production configuration is incomplete: ${missing.map(([name]) => name).join(', ')}`,
      );
    }
  }

  return config;
}
