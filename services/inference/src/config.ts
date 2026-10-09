export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface InferenceConfig {
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
  readonly modelGatewayBaseUrl: string;
  readonly internalToken?: string | undefined;
  readonly modelGatewayInternalToken?: string | undefined;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
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

export function loadInferenceConfig(overrides?: Partial<InferenceConfig>): InferenceConfig {
  const env = overrides?.environment ?? resolveEnvironment(process.env['NODE_ENV']);
  const port = overrides?.port ?? Number.parseInt(process.env['PORT'] ?? '3004', 10);
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
      : [
          'platform-api-gateway',
          'billy-api',
          'ai-orchestrator',
          'ai-platform-admin',
          'agent-runner',
        ]);

  const config: InferenceConfig = {
    serviceName: overrides?.serviceName ?? 'inference',
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
      Number.parseInt(process.env['MAX_BODY_SIZE_BYTES'] ?? '10485760', 10),
    modelGatewayBaseUrl:
      overrides?.modelGatewayBaseUrl ??
      process.env['MODEL_GATEWAY_BASE_URL'] ??
      'http://localhost:3002',
    internalToken:
      overrides?.internalToken ??
      process.env['INFERENCE_INTERNAL_TOKEN'] ??
      process.env['INTERNAL_SERVICE_TOKEN'],
    modelGatewayInternalToken:
      overrides?.modelGatewayInternalToken ??
      process.env['MODEL_GATEWAY_INTERNAL_TOKEN'] ??
      (env === 'production'
        ? undefined
        : (overrides?.internalToken ?? process.env['INTERNAL_SERVICE_TOKEN'])),
    defaultTimeoutMs:
      overrides?.defaultTimeoutMs ??
      Number.parseInt(process.env['DEFAULT_TIMEOUT_MS'] ?? '60000', 10),
    maxTimeoutMs:
      overrides?.maxTimeoutMs ?? Number.parseInt(process.env['MAX_TIMEOUT_MS'] ?? '300000', 10),
    exposeReasoningDefault:
      overrides?.exposeReasoningDefault ?? process.env['EXPOSE_REASONING_DEFAULT'] === 'true',
  };
  if (env === 'production') {
    const missing = [
      ['INFERENCE_INTERNAL_TOKEN', config.internalToken],
      ['MODEL_GATEWAY_INTERNAL_TOKEN', config.modelGatewayInternalToken],
      ['MODEL_GATEWAY_BASE_URL', config.modelGatewayBaseUrl],
    ].filter(([, value]) => !value || value.trim().length === 0);
    if (missing.length > 0)
      throw new Error(
        `Inference production configuration is incomplete: ${missing.map(([name]) => name).join(', ')}`,
      );
  }
  return config;
}
