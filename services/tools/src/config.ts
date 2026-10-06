import type { DatabasePoolConfig } from './infrastructure/database/connection.js';
import type { LogLevel } from './infrastructure/logging/logger.js';

export interface ToolsConfig {
  readonly port: number;
  readonly host: string;
  readonly internalToken?: string | undefined;
  readonly confirmationPrivateKey?: string | undefined;
  readonly confirmationPublicKey?: string | undefined;
  readonly database: DatabasePoolConfig;
  readonly useDatabase: boolean;
  readonly logLevel: LogLevel;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
}

export function loadToolsConfig(overrides: Partial<ToolsConfig> = {}): ToolsConfig {
  const isTest = process.env['NODE_ENV'] === 'test';

  return {
    port: overrides.port ?? Number.parseInt(process.env['TOOLS_SERVICE_PORT'] ?? '3007', 10),
    host: overrides.host ?? process.env['TOOLS_SERVICE_HOST'] ?? '0.0.0.0',
    internalToken: overrides.internalToken ?? process.env['INTERNAL_SERVICE_TOKEN'],
    confirmationPrivateKey:
      overrides.confirmationPrivateKey ?? process.env['TOOLS_CONFIRMATION_PRIVATE_KEY'],
    confirmationPublicKey:
      overrides.confirmationPublicKey ?? process.env['TOOLS_CONFIRMATION_PUBLIC_KEY'],
    database: {
      host:
        overrides.database?.host ?? process.env['TOOLS_DB_HOST'] ?? process.env['DATABASE_HOST'],
      port:
        overrides.database?.port ??
        (process.env['TOOLS_DB_PORT']
          ? Number.parseInt(process.env['TOOLS_DB_PORT'], 10)
          : undefined),
      database:
        overrides.database?.database ??
        process.env['TOOLS_DB_NAME'] ??
        process.env['DATABASE_NAME'] ??
        'oicunt_tools',
      user:
        overrides.database?.user ?? process.env['TOOLS_DB_USER'] ?? process.env['DATABASE_USER'],
      password:
        overrides.database?.password ??
        process.env['TOOLS_DB_PASSWORD'] ??
        process.env['DATABASE_PASSWORD'],
      ssl:
        overrides.database?.ssl ??
        (process.env['DATABASE_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined),
    },
    useDatabase:
      overrides.useDatabase ??
      (!isTest && process.env['USE_DATABASE'] !== 'false' && Boolean(process.env['DATABASE_HOST'])),
    logLevel:
      overrides.logLevel ??
      ((process.env['LOG_LEVEL'] as LogLevel) || (isTest ? 'silent' : 'info')),
    defaultTimeoutMs:
      overrides.defaultTimeoutMs ??
      Number.parseInt(process.env['TOOLS_DEFAULT_TIMEOUT_MS'] ?? '5000', 10),
    maxTimeoutMs:
      overrides.maxTimeoutMs ?? Number.parseInt(process.env['TOOLS_MAX_TIMEOUT_MS'] ?? '30000', 10),
  };
}
