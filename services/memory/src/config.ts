export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password?: string | undefined;
  readonly ssl?: boolean | undefined;
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
}

export interface MemoryConfig {
  readonly serviceName: string;
  readonly version: string;
  readonly port: number;
  readonly host: string;
  readonly environment: string;
  readonly internalToken?: string | undefined;
  readonly allowedServiceIdentities: readonly string[];
  readonly defaultMaxTokens: number;
  readonly defaultMaxMessages: number;
  readonly maxBodySizeBytes: number;
  readonly shutdownTimeoutMs: number;
  readonly database: DatabaseConfig;
  readonly logLevel: string;
}

export function loadMemoryConfig(overrides?: Partial<MemoryConfig>): MemoryConfig {
  const allowedIdentitiesRaw =
    process.env['ALLOWED_SERVICE_IDENTITIES'] ??
    'ai-orchestrator,billy-api,agent-runner,platform-api-gateway,ai-platform-admin,memory-worker';

  const defaultAllowedIdentities = allowedIdentitiesRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    serviceName: overrides?.serviceName ?? process.env['SERVICE_NAME'] ?? 'memory',
    version: overrides?.version ?? process.env['SERVICE_VERSION'] ?? '0.1.0',
    port:
      overrides?.port ??
      Number.parseInt(process.env['PORT'] ?? process.env['MEMORY_PORT'] ?? '3005', 10),
    host: overrides?.host ?? process.env['HOST'] ?? '0.0.0.0',
    environment: overrides?.environment ?? process.env['NODE_ENV'] ?? 'development',
    internalToken:
      overrides?.internalToken !== undefined
        ? overrides.internalToken
        : (process.env['INTERNAL_AUTH_TOKEN'] ?? process.env['MEMORY_INTERNAL_TOKEN'] ?? undefined),
    allowedServiceIdentities: Object.freeze(
      overrides?.allowedServiceIdentities ?? defaultAllowedIdentities,
    ),
    defaultMaxTokens:
      overrides?.defaultMaxTokens ??
      Number.parseInt(process.env['DEFAULT_MAX_TOKENS'] ?? '8192', 10),
    defaultMaxMessages:
      overrides?.defaultMaxMessages ??
      Number.parseInt(process.env['DEFAULT_MAX_MESSAGES'] ?? '50', 10),
    maxBodySizeBytes:
      overrides?.maxBodySizeBytes ??
      Number.parseInt(process.env['MAX_BODY_SIZE_BYTES'] ?? '10485760', 10),
    shutdownTimeoutMs:
      overrides?.shutdownTimeoutMs ??
      Number.parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '5000', 10),
    logLevel: overrides?.logLevel ?? process.env['LOG_LEVEL'] ?? 'info',
    database: {
      host: overrides?.database?.host ?? process.env['DATABASE_HOST'] ?? 'localhost',
      port:
        overrides?.database?.port ?? Number.parseInt(process.env['DATABASE_PORT'] ?? '5432', 10),
      database: overrides?.database?.database ?? process.env['DATABASE_NAME'] ?? 'oicunt_memory',
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
    },
  };
}
