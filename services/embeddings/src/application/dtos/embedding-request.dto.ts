export interface GenerateEmbeddingsInputDto {
  /** Canonical model identifier (e.g. 'oicunt.model.catalog-embedding', 'text-embedding-3-small') */
  readonly model: string;
  /** Non-empty array of raw input strings to embed */
  readonly inputs: readonly string[];
  /** Optional custom dimension override for models supporting variable dimensions */
  readonly dimensions?: number | undefined;
  /** Optional caller audit/tracking metadata */
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface GenerateEmbeddingsContextDto {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly correlationId: string;
  readonly requestId: string;
  readonly deadlineAt?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}
