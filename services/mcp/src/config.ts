import type { DatabasePoolConfig } from './infrastructure/database/connection.js';
import type { LogLevel } from './infrastructure/logging/logger.js';

export interface McpConfig {
  readonly port: number;
  readonly host: string;
  readonly internalToken?: string | undefined;
  readonly database: DatabasePoolConfig;
  readonly useDatabase: boolean;
  readonly logLevel: LogLevel;
  readonly toolsServiceUrl: string;
  readonly allowLocalhost: boolean;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
  readonly isProduction: boolean;
  readonly allowedStdioExecutables: readonly string[];
}

export function loadMcpConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  const isTest = process.env['NODE_ENV'] === 'test';

  return {
    port: overrides.port ?? Number.parseInt(process.env['MCP_SERVICE_PORT'] ?? '3008', 10),
    host: overrides.host ?? process.env['MCP_SERVICE_HOST'] ?? '0.0.0.0',
    internalToken: overrides.internalToken ?? process.env['INTERNAL_SERVICE_TOKEN'],
    database: {
      host: overrides.database?.host ?? process.env['MCP_DB_HOST'] ?? process.env['DATABASE_HOST'],
      port:
        overrides.database?.port ??
        (process.env['MCP_DB_PORT'] ? Number.parseInt(process.env['MCP_DB_PORT'], 10) : undefined),
      database:
        overrides.database?.database ??
        process.env['MCP_DB_NAME'] ??
        process.env['DATABASE_NAME'] ??
        'oicunt_mcp',
      user: overrides.database?.user ?? process.env['MCP_DB_USER'] ?? process.env['DATABASE_USER'],
      password:
        overrides.database?.password ??
        process.env['MCP_DB_PASSWORD'] ??
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
    toolsServiceUrl:
      overrides.toolsServiceUrl ?? process.env['TOOLS_SERVICE_URL'] ?? 'http://localhost:3007',
    allowLocalhost:
      overrides.allowLocalhost ?? (isTest || process.env['NODE_ENV'] !== 'production'),
    defaultTimeoutMs:
      overrides.defaultTimeoutMs ??
      Number.parseInt(process.env['MCP_DEFAULT_TIMEOUT_MS'] ?? '30000', 10),
    maxTimeoutMs:
      overrides.maxTimeoutMs ?? Number.parseInt(process.env['MCP_MAX_TIMEOUT_MS'] ?? '120000', 10),
    isProduction: overrides.isProduction ?? process.env['NODE_ENV'] === 'production',
    allowedStdioExecutables:
      overrides.allowedStdioExecutables ??
      (process.env['MCP_ALLOWED_STDIO_EXECUTABLES']
        ? process.env['MCP_ALLOWED_STDIO_EXECUTABLES'].split(',').map((s) => s.trim())
        : ['node', 'npx', 'python', 'python3', 'uvx', 'uv', 'deno', 'bun']),
  };
}
