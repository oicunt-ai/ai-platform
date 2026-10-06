import type { DatabasePoolConfig } from './infrastructure/database/connection.js';
import type { LogLevel } from './infrastructure/logging/logger.js';

export interface AgentsConfig {
  readonly port: number;
  readonly host: string;
  readonly internalToken?: string | undefined;
  readonly inferenceServiceUrl: string;
  readonly toolsServiceUrl: string;
  readonly knowledgeServiceUrl: string;
  readonly database: DatabasePoolConfig;
  readonly useDatabase: boolean;
  readonly logLevel: LogLevel;
  readonly defaultMaxSteps: number;
  readonly defaultTimeoutMs: number;
  readonly rabbitmqUrl: string;
  readonly useRabbitMq: boolean;
}

export function loadAgentsConfig(overrides: Partial<AgentsConfig> = {}): AgentsConfig {
  const isTest = process.env['NODE_ENV'] === 'test';

  return {
    port: overrides.port ?? Number.parseInt(process.env['AGENTS_SERVICE_PORT'] ?? '8088', 10),
    host: overrides.host ?? process.env['AGENTS_SERVICE_HOST'] ?? '0.0.0.0',
    internalToken: overrides.internalToken ?? process.env['INTERNAL_SERVICE_TOKEN'],
    inferenceServiceUrl:
      overrides.inferenceServiceUrl ??
      process.env['INFERENCE_SERVICE_URL'] ??
      'http://localhost:3004',
    toolsServiceUrl:
      overrides.toolsServiceUrl ?? process.env['TOOLS_SERVICE_URL'] ?? 'http://localhost:3007',
    knowledgeServiceUrl:
      overrides.knowledgeServiceUrl ??
      process.env['KNOWLEDGE_SERVICE_URL'] ??
      'http://localhost:3005',
    database: {
      host:
        overrides.database?.host ?? process.env['AGENTS_DB_HOST'] ?? process.env['DATABASE_HOST'],
      port:
        overrides.database?.port ??
        (process.env['AGENTS_DB_PORT']
          ? Number.parseInt(process.env['AGENTS_DB_PORT'], 10)
          : undefined),
      database:
        overrides.database?.database ??
        process.env['AGENTS_DB_NAME'] ??
        process.env['DATABASE_NAME'] ??
        'oicunt_agents',
      user:
        overrides.database?.user ?? process.env['AGENTS_DB_USER'] ?? process.env['DATABASE_USER'],
      password:
        overrides.database?.password ??
        process.env['AGENTS_DB_PASSWORD'] ??
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
    defaultMaxSteps:
      overrides.defaultMaxSteps ??
      Number.parseInt(process.env['AGENTS_DEFAULT_MAX_STEPS'] ?? '15', 10),
    defaultTimeoutMs:
      overrides.defaultTimeoutMs ??
      Number.parseInt(process.env['AGENTS_DEFAULT_TIMEOUT_MS'] ?? '120000', 10),
    rabbitmqUrl:
      overrides.rabbitmqUrl ?? process.env['RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672',
    useRabbitMq:
      overrides.useRabbitMq ??
      (!isTest && process.env['USE_RABBITMQ'] !== 'false' && Boolean(process.env['RABBITMQ_URL'])),
  };
}
