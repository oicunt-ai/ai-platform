export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface AiOrchestratorConfig {
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
  readonly modelRegistryBaseUrl: string;
  readonly inferenceBaseUrl: string;
  readonly memoryBaseUrl: string;
  readonly internalToken?: string | undefined;
  readonly modelRegistryInternalToken?: string | undefined;
  readonly inferenceInternalToken?: string | undefined;
  readonly memoryInternalToken?: string | undefined;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
  readonly cacheTtlSeconds: number;
  readonly exposeReasoningDefault: boolean;
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

export function loadAiOrchestratorConfig(
  overrides?: Partial<AiOrchestratorConfig>,
): AiOrchestratorConfig {
  const env = overrides?.environment ?? resolveEnvironment(process.env['NODE_ENV']);
  const port = overrides?.port ?? Number.parseInt(process.env['PORT'] ?? '3003', 10);
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
      ? process.env['ALLOWED_SERVICE_IDENTITIES']
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['platform-api-gateway', 'api-gateway', 'billy-api', 'ai-platform-admin', 'agent-runner']);

  const config: AiOrchestratorConfig = {
    serviceName: overrides?.serviceName ?? 'ai-orchestrator',
    environment: env,
    port,
    host,
    version: overrides?.version ?? '1.0.0',
    shutdownTimeoutMs,
    enableTelemetry,
    logLevel,
    allowedServiceIdentities: allowedServices,
    maxBodySizeBytes:
      overrides?.maxBodySizeBytes ??
      Number.parseInt(process.env['MAX_BODY_SIZE_BYTES'] ?? '10485760', 10), // 10MB
    modelRegistryBaseUrl:
      overrides?.modelRegistryBaseUrl ??
      process.env['MODEL_REGISTRY_BASE_URL'] ??
      'http://localhost:3001',
    inferenceBaseUrl:
      overrides?.inferenceBaseUrl ?? process.env['INFERENCE_BASE_URL'] ?? 'http://localhost:3004',
    memoryBaseUrl:
      overrides?.memoryBaseUrl ?? process.env['MEMORY_BASE_URL'] ?? 'http://localhost:3005',
    internalToken:
      overrides?.internalToken ??
      process.env['AI_ORCHESTRATOR_INTERNAL_TOKEN'] ??
      process.env['INTERNAL_SERVICE_TOKEN'],
    modelRegistryInternalToken:
      overrides?.modelRegistryInternalToken ??
      process.env['MODEL_REGISTRY_INTERNAL_TOKEN'] ??
      (env === 'production'
        ? undefined
        : (overrides?.internalToken ?? process.env['INTERNAL_SERVICE_TOKEN'])),
    inferenceInternalToken:
      overrides?.inferenceInternalToken ??
      process.env['INFERENCE_INTERNAL_TOKEN'] ??
      (env === 'production'
        ? undefined
        : (overrides?.internalToken ?? process.env['INTERNAL_SERVICE_TOKEN'])),
    memoryInternalToken:
      overrides?.memoryInternalToken ??
      process.env['MEMORY_INTERNAL_TOKEN'] ??
      (env === 'production'
        ? undefined
        : (overrides?.internalToken ?? process.env['INTERNAL_SERVICE_TOKEN'])),
    defaultTimeoutMs:
      overrides?.defaultTimeoutMs ??
      Number.parseInt(process.env['DEFAULT_TIMEOUT_MS'] ?? '120000', 10),
    maxTimeoutMs:
      overrides?.maxTimeoutMs ?? Number.parseInt(process.env['MAX_TIMEOUT_MS'] ?? '300000', 10),
    cacheTtlSeconds:
      overrides?.cacheTtlSeconds ?? Number.parseInt(process.env['CACHE_TTL_SECONDS'] ?? '45', 10),
    exposeReasoningDefault:
      overrides?.exposeReasoningDefault ?? process.env['EXPOSE_REASONING_DEFAULT'] === 'true',
  };
  if (env === 'production') {
    const missing = [
      ['AI_ORCHESTRATOR_INTERNAL_TOKEN', config.internalToken],
      ['MODEL_REGISTRY_INTERNAL_TOKEN', config.modelRegistryInternalToken],
      ['INFERENCE_INTERNAL_TOKEN', config.inferenceInternalToken],
      ['MEMORY_INTERNAL_TOKEN', config.memoryInternalToken],
      ['MODEL_REGISTRY_BASE_URL', config.modelRegistryBaseUrl],
      ['INFERENCE_BASE_URL', config.inferenceBaseUrl],
      ['MEMORY_BASE_URL', config.memoryBaseUrl],
    ].filter(([, value]) => !value || value.trim().length === 0 || value === 'in-memory');
    if (missing.length > 0)
      throw new Error(
        `AI Orchestrator production configuration is incomplete: ${missing.map(([name]) => name).join(', ')}`,
      );
  }
  return config;
}
