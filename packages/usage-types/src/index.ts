/**
 * Quantitative measurements representing physical consumption.
 * Provider-neutral metric keys mapped to numerical quantities.
 * Missing measurements must remain absent (undefined) rather than default to zero.
 */
export interface UsageMeasurements {
  /** LLM input/prompt tokens processed */
  readonly 'tokens.input'?: number | undefined;
  /** LLM output/completion tokens generated */
  readonly 'tokens.output'?: number | undefined;
  /** Total LLM tokens (sum of input + output) */
  readonly 'tokens.total'?: number | undefined;
  /** Tokens read from prompt cache */
  readonly 'tokens.cached_input'?: number | undefined;
  /** Tokens written to create a prompt cache entry */
  readonly 'tokens.cache_creation'?: number | undefined;
  /** Normalized internal reasoning / extended thinking tokens generated */
  readonly 'tokens.reasoning'?: number | undefined;

  /** Tokens consumed during vector embedding generation */
  readonly 'tokens.embedding'?: number | undefined;
  /** Number of discrete vector embeddings produced */
  readonly 'units.vectors'?: number | undefined;

  /** Total discrete request count (typically 1) */
  readonly 'units.requests'?: number | undefined;
  /** Tool invocations count (typically 1) */
  readonly 'units.invocations'?: number | undefined;
  /** Autonomous agent steps executed */
  readonly 'units.steps'?: number | undefined;
  /** Autonomous agent runs executed */
  readonly 'units.runs'?: number | undefined;

  /** Wall-clock execution duration in milliseconds */
  readonly 'duration.total_ms'?: number | undefined;
  /** Sandboxed CPU / compute duration in milliseconds */
  readonly 'duration.compute_ms'?: number | undefined;
  /** Network egress bytes generated during tool execution */
  readonly 'network.egress_bytes'?: number | undefined;
}

/**
 * Union of all standard normalized measurement keys.
 */
export type UsageMeasurementKey = keyof UsageMeasurements;

/**
 * Distributed tracing and request lineage metadata.
 */
export interface UsageEventLineage {
  /** Global distributed tracing correlation ID */
  readonly correlationId: string;
  /** Discrete HTTP or RPC request ID */
  readonly requestId: string;
  /** Conversational session ID (e.g. Orchestrator / Memory session) */
  readonly sessionId?: string | undefined;
  /** Autonomous agent run ID (if emitted during agent execution) */
  readonly runId?: string | undefined;
  /** Specific step number or step ID within an agent run */
  readonly stepId?: string | undefined;
  /** Parent event ID for hierarchical sub-tasks or reversals */
  readonly parentEventId?: string | undefined;
}

/**
 * Foundational durable record representing a single discrete unit of consumption.
 */
export interface UsageEvent {
  /**
   * Globally unique identifier for this usage event.
   * Monotonically ordered UUIDv7 or ULID or UUID.
   */
  readonly eventId: string;

  /**
   * Semantic schema version of the usage event contract.
   */
  readonly schemaVersion: '1.0.0' | string;

  /**
   * Authoritative customer tenant identifier (mandatory multi-tenant boundary).
   */
  readonly tenantId: string;

  /**
   * Individual end-user identity who initiated or owns the action.
   * Optional for service-to-service, system-level, or automated platform workloads.
   * Synthetic user identities must NEVER be fabricated.
   */
  readonly userId?: string | undefined;

  /**
   * Principal actor or service identity that executed the action.
   * Optional when usage is service-level, system-level, or otherwise not
   * attributable to a discrete human actor.
   * Synthetic actor identities must NEVER be fabricated.
   */
  readonly actorId?: string | undefined;

  /**
   * Commercial or application product boundary generating the consumption.
   * Example: 'billy', 'platform-api', 'enterprise-agent', 'developer-console'
   */
  readonly productId: string;

  /**
   * Specific OICUNT internal service emitting the usage.
   * Example: 'model-gateway', 'tools', 'agents', 'embeddings', 'mcp'
   */
  readonly sourceService:
    'model-gateway' | 'inference' | 'embeddings' | 'tools' | 'agents' | 'mcp' | string;

  /**
   * Specific operation or capability invoked.
   * Example: 'model.completion', 'model.embedding', 'tool.execution', 'agent.step', 'usage.reversal'
   */
  readonly operation: string;

  /**
   * Canonical platform resource identifier associated with the consumption.
   * Canonical model ID (e.g. 'oicunt.model.catalog-alpha'),
   * Canonical tool ID (e.g. 'oicunt.tool.code-sandbox'),
   * or Agent ID (e.g. 'agent_researcher_v2').
   */
  readonly resourceId: string;

  /**
   * Quantitative measurements for this event.
   */
  readonly measurements: UsageMeasurements;

  /**
   * Contextual categorical dimensions for reporting and filtering.
   * Must contain only low-to-medium cardinality scalar values.
   */
  readonly dimensions: Record<string, string | number | boolean>;

  /**
   * Distributed tracing and request lineage metadata.
   */
  readonly lineage: UsageEventLineage;

  /**
   * Deterministic idempotency key for deduplication.
   * Unique per discrete execution invocation across retries.
   */
  readonly idempotencyKey: string;

  /**
   * Exact ISO 8601 timestamp when the measured action occurred at the source.
   */
  readonly occurredAt: string;

  /**
   * ISO 8601 timestamp when the event was ingested by the Usage Service.
   */
  readonly ingestedAt?: string | undefined;
}

/**
 * Result of ingesting a single usage event.
 */
export interface IngestUsageResult {
  readonly eventId: string;
  readonly status: 'persisted' | 'duplicate';
  readonly occurredAt: string;
}

/**
 * Result of batch ingesting usage events.
 */
export interface BatchIngestUsageResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly results: readonly IngestUsageResult[];
}

/**
 * Query parameters for usage summary.
 */
export interface UsageSummaryQuery {
  readonly tenantId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly productId?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly sourceService?: string | undefined;
  readonly operation?: string | undefined;
}

/**
 * Aggregated totals for usage summary.
 */
export interface UsageSummaryResult {
  readonly tenantId: string;
  readonly window: {
    readonly startTime: string;
    readonly endTime: string;
  };
  readonly totals: Record<string, number>;
  readonly eventCount: number;
}

/**
 * Granularity for timeseries queries.
 */
export type UsageGranularity = 'hourly' | 'daily';

/**
 * Query parameters for usage timeseries.
 */
export interface UsageTimeseriesQuery {
  readonly tenantId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly granularity?: UsageGranularity | undefined;
  readonly productId?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly sourceService?: string | undefined;
  readonly metric?: string | undefined;
}

/**
 * Discrete timeseries data point.
 */
export interface UsageTimeseriesPoint {
  readonly bucket: string;
  readonly metrics: Record<string, number>;
  readonly eventCount: number;
}

/**
 * Result of a timeseries query.
 */
export interface UsageTimeseriesResult {
  readonly tenantId: string;
  readonly granularity: UsageGranularity;
  readonly series: readonly UsageTimeseriesPoint[];
}

/**
 * Query parameters for querying raw usage events.
 */
export interface UsageEventsQuery {
  readonly tenantId: string;
  readonly correlationId?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly sourceService?: string | undefined;
  readonly operation?: string | undefined;
  readonly startTime?: string | undefined;
  readonly endTime?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

/**
 * Result of raw usage events query.
 */
export interface UsageEventsResult {
  readonly events: readonly UsageEvent[];
  readonly totalCount: number;
  readonly nextCursor?: string | undefined;
}

/**
 * Request parameters for creating an append-only reversal/correction.
 */
export interface CreateReversalParams {
  readonly tenantId: string;
  readonly originalEventId: string;
  readonly reason: string;
  /**
   * Optional partial measurements to reverse.
   * If not provided, reverses 100% of the original event's measurements as negative deltas.
   */
  readonly negativeMeasurements?: Partial<UsageMeasurements> | undefined;
  readonly dimensions?: Record<string, string | number | boolean> | undefined;
  readonly correlationId?: string | undefined;
  readonly requestId?: string | undefined;
}
