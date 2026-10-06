export interface EmbeddingsConfig {
  readonly serviceName: string;
  readonly version: string;
  readonly port: number;
  readonly host: string;
  readonly environment: string;
  readonly internalToken?: string | undefined;
  readonly allowedServiceIdentities: readonly string[];
  readonly maxBatchSize: number;
  readonly maxItemCharacters: number;
  readonly maxBodySizeBytes: number;
  readonly shutdownTimeoutMs: number;
  readonly logLevel: string;
  readonly modelRegistryUrl: string;
  readonly modelGatewayUrl: string;
  readonly downstreamTimeoutMs: number;
}

export function loadEmbeddingsConfig(overrides?: Partial<EmbeddingsConfig>): EmbeddingsConfig {
  const allowedIdentitiesRaw =
    process.env['ALLOWED_SERVICE_IDENTITIES'] ??
    'knowledge,ai-orchestrator,memory,inference,platform-api-gateway,ai-platform-admin';

  const defaultAllowedIdentities = allowedIdentitiesRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    serviceName: overrides?.serviceName ?? process.env['SERVICE_NAME'] ?? 'embeddings',
    version: overrides?.version ?? process.env['SERVICE_VERSION'] ?? '0.1.0',
    port:
      overrides?.port ??
      Number.parseInt(process.env['PORT'] ?? process.env['EMBEDDINGS_PORT'] ?? '3007', 10),
    host: overrides?.host ?? process.env['HOST'] ?? '0.0.0.0',
    environment: overrides?.environment ?? process.env['NODE_ENV'] ?? 'development',
    internalToken:
      overrides?.internalToken !== undefined
        ? overrides.internalToken
        : (process.env['INTERNAL_AUTH_TOKEN'] ??
          process.env['EMBEDDINGS_INTERNAL_TOKEN'] ??
          undefined),
    allowedServiceIdentities: Object.freeze(
      overrides?.allowedServiceIdentities ?? defaultAllowedIdentities,
    ),
    maxBatchSize:
      overrides?.maxBatchSize ?? Number.parseInt(process.env['MAX_BATCH_SIZE'] ?? '256', 10),
    maxItemCharacters:
      overrides?.maxItemCharacters ??
      Number.parseInt(process.env['MAX_ITEM_CHARACTERS'] ?? '32768', 10),
    maxBodySizeBytes:
      overrides?.maxBodySizeBytes ??
      Number.parseInt(process.env['MAX_BODY_SIZE_BYTES'] ?? '10485760', 10),
    shutdownTimeoutMs:
      overrides?.shutdownTimeoutMs ??
      Number.parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '5000', 10),
    logLevel: overrides?.logLevel ?? process.env['LOG_LEVEL'] ?? 'info',
    modelRegistryUrl:
      overrides?.modelRegistryUrl ?? process.env['MODEL_REGISTRY_URL'] ?? 'http://localhost:3001',
    modelGatewayUrl:
      overrides?.modelGatewayUrl ?? process.env['MODEL_GATEWAY_URL'] ?? 'http://localhost:3002',
    downstreamTimeoutMs:
      overrides?.downstreamTimeoutMs ??
      Number.parseInt(process.env['DOWNSTREAM_TIMEOUT_MS'] ?? '30000', 10),
  };
}
