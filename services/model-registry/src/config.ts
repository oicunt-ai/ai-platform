export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password?: string | undefined;
  readonly ssl: boolean;
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
}

export interface CacheConfig {
  readonly enabled: boolean;
  readonly defaultTtlSeconds: number;
  readonly staleTtlSeconds: number;
}

export interface ModelRegistryConfig {
  readonly serviceName: string;
  readonly environment: Environment;
  readonly port: number;
  readonly host: string;
  readonly version: string;
  readonly shutdownTimeoutMs: number;
  readonly enableTelemetry: boolean;
  readonly logLevel: string;
  readonly database: DatabaseConfig;
  readonly cache: CacheConfig;
  readonly allowedServiceIdentities: readonly string[];
  readonly internalAuthToken?: string | undefined;
  readonly maxBodySizeBytes: number;
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

export function loadModelRegistryConfig(
  overrides?: Partial<ModelRegistryConfig>,
): ModelRegistryConfig {
  const env = overrides?.environment ?? resolveEnvironment(process.env['NODE_ENV']);
  const port = overrides?.port ?? Number.parseInt(process.env['PORT'] ?? '3001', 10);
  const host = overrides?.host ?? process.env['HOST'] ?? '0.0.0.0';
  const shutdownTimeoutMs =
    overrides?.shutdownTimeoutMs ??
    Number.parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '5000', 10);
  const enableTelemetry = overrides?.enableTelemetry ?? process.env['ENABLE_TELEMETRY'] !== 'false';
  const logLevel = overrides?.logLevel ?? process.env['LOG_LEVEL'] ?? 'info';

  const dbConfig: DatabaseConfig = {
    host: overrides?.database?.host ?? process.env['DATABASE_HOST'] ?? 'localhost',
    port: overrides?.database?.port ?? Number.parseInt(process.env['DATABASE_PORT'] ?? '5432', 10),
    database: overrides?.database?.database ?? process.env['DATABASE_NAME'] ?? 'oicunt_ai',
    user: overrides?.database?.user ?? process.env['DATABASE_USER'] ?? 'postgres',
    password: overrides?.database?.password ?? process.env['DATABASE_PASSWORD'] ?? '',
    ssl: overrides?.database?.ssl ?? process.env['DATABASE_SSL'] === 'true',
    maxConnections:
      overrides?.database?.maxConnections ??
      Number.parseInt(process.env['DATABASE_POOL_MAX'] ?? '20', 10),
    idleTimeoutMs:
      overrides?.database?.idleTimeoutMs ??
      Number.parseInt(process.env['DATABASE_IDLE_TIMEOUT_MS'] ?? '10000', 10),
    connectionTimeoutMs:
      overrides?.database?.connectionTimeoutMs ??
      Number.parseInt(process.env['DATABASE_CONN_TIMEOUT_MS'] ?? '3000', 10),
  };

  const cacheConfig: CacheConfig = {
    enabled: overrides?.cache?.enabled ?? process.env['CACHE_ENABLED'] !== 'false',
    defaultTtlSeconds:
      overrides?.cache?.defaultTtlSeconds ??
      Number.parseInt(process.env['CACHE_DEFAULT_TTL_SECONDS'] ?? '60', 10),
    staleTtlSeconds:
      overrides?.cache?.staleTtlSeconds ??
      Number.parseInt(process.env['CACHE_STALE_TTL_SECONDS'] ?? '300', 10),
  };

  const allowedServiceIdentities =
    overrides?.allowedServiceIdentities ??
    (process.env['ALLOWED_SERVICE_IDENTITIES']
      ? process.env['ALLOWED_SERVICE_IDENTITIES'].split(',').map((s) => s.trim())
      : ['ai-orchestrator', 'model-gateway', 'ai-platform-admin']);

  const config: ModelRegistryConfig = {
    serviceName: overrides?.serviceName ?? 'model-registry',
    environment: env,
    port: Number.isNaN(port) ? 3001 : port,
    host,
    version: overrides?.version ?? '0.1.0',
    shutdownTimeoutMs: Number.isNaN(shutdownTimeoutMs) ? 5000 : shutdownTimeoutMs,
    enableTelemetry,
    logLevel,
    database: Object.freeze(dbConfig),
    cache: Object.freeze(cacheConfig),
    allowedServiceIdentities: Object.freeze(allowedServiceIdentities),
    internalAuthToken:
      overrides?.internalAuthToken ??
      process.env['MODEL_REGISTRY_INTERNAL_TOKEN'] ??
      process.env['INTERNAL_AUTH_TOKEN'],
    maxBodySizeBytes:
      overrides?.maxBodySizeBytes ??
      Number.parseInt(process.env['MAX_BODY_SIZE_BYTES'] ?? '1048576', 10),
  };

  if (config.port < 0 || config.port > 65535) {
    throw new Error(`Invalid port configuration: ${config.port}`);
  }

  if (env === 'production') {
    const missing = [
      ['MODEL_REGISTRY_INTERNAL_TOKEN', config.internalAuthToken],
      ['DATABASE_HOST', config.database.host],
      ['DATABASE_USER', config.database.user],
      ['DATABASE_PASSWORD', config.database.password],
    ].filter(([, value]) => !value || value.trim().length === 0);
    if (missing.length > 0) {
      throw new Error(
        `Model Registry production configuration is incomplete: ${missing.map(([name]) => name).join(', ')}`,
      );
    }
  }

  return Object.freeze(config);
}
