# OICUNT Platform Contract: Usage & Metering Architecture Specification

**Document Version**: 1.0.0  
**Status**: Authoritative Architectural Contract  
**Classification**: Engineering Architecture Standard  
**Capability Location**: Platform Capability / `services/usage`

---

## 1. Executive Summary & Purpose

The **Usage & Metering Service** (`services/usage`) is the authoritative, centralized **measurement, deduplication, persistence, aggregation, and query boundary** for operational consumption across the entire OICUNT platform. Its sole responsibility is to accurately record **what happened, when it happened, who caused it, and what resources were consumed**.

Usage metering is a foundational, company-wide platform capability. In modern AI platforms, consumption encompasses heterogeneous, high-velocity dimensions: large language model tokens (input, output, cached, and reasoning tokens), vector embedding generation, sandboxed tool compute durations, autonomous agent run iterations, and external Model Context Protocol (MCP) interactions.

The Usage Service provides an uncompromised, provider-neutral abstraction over consumption: capturing durable, immutable usage events from all runtime systems; deduplicating events across at-least-once delivery channels; persistently storing raw records in an isolated, dedicated database; computing deterministic rollups; and exposing query APIs to downstream consumers such as Billing, Subscriptions, Entitlements, Analytics, and Customer Dashboards.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                OICUNT Runtime Services                                 │
│  Model Gateway • Embeddings • Tools • Autonomous Agents • MCP Server Gateway • BILLY   │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Asynchronous Event Emission
                                            │ (RabbitMQ: oicunt.usage / Non-blocking HTTP)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Usage & Metering Service                                  │
│                                                                                        │
│   • Schema Validation & Tenant Boundary Check    • At-Least-Once Event Deduplication  │
│   • Normalized Provider-Neutral AI Metrics       • Append-Only Immutable Persistence   │
│   • Materialized Temporal Rollups (Hourly/Daily) • Downstream Query & Audit APIs       │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Dedicated Storage Engine (PostgreSQL)                           │
│           oicunt_usage schema • usage_events (raw) • usage_aggregates (rollups)        │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Authorized Read Queries
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Downstream Enterprise Systems                             │
│       Billing & Invoicing • Subscription Plans • Entitlements & Quotas • Dashboards    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Cardinal Non-Blocking Invariant**: The Usage Service is strictly **out of the runtime execution critical path**. Runtime execution (inference, model gateway dispatches, vector embeddings, tool sandboxes, agent steps) must **NEVER** depend on synchronous calls to the Usage Service to proceed or succeed. A degradation or outage of the Usage Service must **never** prevent users from generating model completions or executing tools.

---

## 2. Core Responsibilities & Non-Responsibilities

To maintain architectural purity across the OICUNT enterprise, the boundaries of the Usage Service are explicitly partitioned from business, commercial, and execution concerns.

### 2.1 Authoritative Responsibilities

1. **Measurement Intake & Validation**: Ingest usage events emitted by trusted platform services, validating event structure against strict schema versions.
2. **At-Least-Once Deduplication**: Guarantee that duplicate deliveries over message brokers or network retries are recognized and processed idempotently without double-counting.
3. **Immutable Persistence**: Store raw, immutable usage events as the authoritative historical audit log of platform activity.
4. **Normalized Measurement Representation**: Standardize AI and compute metrics into provider-neutral units (tokens, milliseconds, invocations, vectors).
5. **Multi-Tenant Attribution**: Ensure every measurement is strictly bound to an authoritative `tenantId` and `productId`. Support optional `userId` and `actorId` for user-initiated actions, without ever mandating synthetic user or actor identities for service-level, system-level, or automated platform workloads.
6. **Correlation & Request Lineage**: Preserve distributed tracing identifiers (`correlationId`, `requestId`, `sessionId`, `runId`, `parentEventId`).
7. **Aggregations & Materialized Rollups**: Compute and maintain deterministic temporal rollups (hourly, daily, monthly) by tenant, product, service, and resource.
8. **Query & Reporting Interfaces**: Expose low-latency, read-only internal APIs for downstream services to inspect tenant consumption, audit usage, and generate timeseries metrics.

### 2.2 Explicit Non-Responsibilities

| Capability                          | Authoritative Owner            | Why Usage Must NOT Own It                                                                                                                                                                 |
| :---------------------------------- | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pricing & Cost Calculation**      | **Billing Service**            | Pricing rules change dynamically (discounts, enterprise contracts, promotional credits). Usage records **physical consumption** (tokens, ms), not currency ($ or credits).                |
| **Invoicing & Payments**            | **Billing Service**            | Payment gateway integrations (Stripe, Adyen), tax calculations, credit card charges, and PDF invoices belong strictly to commercial finance systems.                                      |
| **Subscription Management**         | **Subscriptions Service**      | Tier definitions (Free, Pro, Enterprise), seat counts, renewal dates, and subscription status are commercial state machines.                                                              |
| **Entitlement & Quota Enforcement** | **Entitlements / Gateway**     | Evaluating whether a tenant is permitted to perform an action (e.g. rate limits, feature gates, hard spend caps) occurs at ingress or gateway boundaries, not in post-execution metering. |
| **Runtime Execution**               | **Inference / Tools / Agents** | Usage does not run models, sandboxes, or agent loops.                                                                                                                                     |
| **Model Routing & Provider Egress** | **Model Gateway**              | Usage never calls external model providers (OpenAI, Anthropic, Google, AWS) and imports zero provider SDKs.                                                                               |
| **Tool Execution & Sandboxing**     | **Tools Service**              | Usage never manages microVMs, WASM runtimes, or network firewalls.                                                                                                                        |

### 2.3 The Four Questions of Platform Commercialization

```
┌──────────────────┐    ┌───────────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐
│   Entitlements   │    │       Subscriptions       │    │        Usage        │    │     Billing      │
├──────────────────┤    ├───────────────────────────┤    ├─────────────────────┤    ├──────────────────┤
│ "What are they   │    │ "What plan or package     │    │ "What actually      │    │ "How much should │
│ allowed to use?" │    │  does the tenant own?"    │    │  happened?"         │    │  it cost?"       │
└──────────────────┘    └───────────────────────────┘    └─────────────────────┘    └──────────────────┘
```

---

## 3. Usage Event Contract (`UsageEvent`)

The `UsageEvent` is the foundational, durable record representing a single discrete unit of consumption. It is designed to be universal, extensible, and capable of attributing any platform workload (AI tokens, vector compute, sandbox durations, MCP gateway proxying, and future OICUNT products).

### 3.1 Event Schema

```typescript
export interface UsageEvent {
  /**
   * Globally unique identifier for this usage event.
   * Monotonically ordered UUIDv7 or ULID.
   */
  readonly eventId: string;

  /**
   * Semantic schema version of the usage event contract.
   * Example: '1.0.0'
   */
  readonly schemaVersion: '1.0.0';

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
   * Example: 'model.completion', 'model.embedding', 'tool.execution', 'agent.step'
   */
  readonly operation: string;

  /**
   * Canonical platform resource identifier associated with the consumption.
   * Canonical model ID (e.g. 'oicunt.model.anthropic.claude-3-5-sonnet'),
   * Canonical tool ID (e.g. 'oicunt.tool.code-sandbox'),
   * or Agent ID (e.g. 'agent_researcher_v2').
   */
  readonly resourceId: string;

  /**
   * Quantitative measurements for this event.
   * Provider-neutral metric keys mapped to numerical quantities.
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
```

### 3.2 Quantitative Measurements (`UsageMeasurements`)

The measurements dictionary holds provider-neutral numerical quantities. Metrics not applicable to a given operation must be omitted (`undefined`) rather than defaulted to zero.

```typescript
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

  /** Wall-clock execution duration in milliseconds */
  readonly 'duration.total_ms'?: number | undefined;
  /** Sandboxed CPU / compute duration in milliseconds */
  readonly 'duration.compute_ms'?: number | undefined;
  /** Network egress bytes generated during tool execution */
  readonly 'network.egress_bytes'?: number | undefined;
}
```

> [!NOTE]
> **Embedding Measurement vs Resource Characteristics**: Embedding vector dimension length (e.g. 768, 1536, 3072) is an invariant architectural property of the embedding model and configuration, **not a consumption unit**. Vector dimensions must be captured as metadata in `dimensions.embedding_dimension` (e.g. `1536`), whereas physical consumption is measured strictly in `tokens.embedding` and `units.vectors`.

### 3.3 Request Lineage (`UsageEventLineage`)

Lineage links usage events back to user actions, conversations, and agent runs across distributed boundaries:

```typescript
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
  /** Parent event ID for hierarchical sub-tasks or sub-agent calls */
  readonly parentEventId?: string | undefined;
}
```

---

## 4. Normalized AI Usage Model

Upstream AI model providers (OpenAI, Anthropic, Google Gemini, AWS Bedrock, Mistral) expose token accounting with divergent schemas, terminology, and granularity. The Usage Service enforces **strict normalization** at the ingest boundary:

### 4.1 Token Normalization Standards

1. **Input Tokens (`tokens.input`)**: Normalized prompt tokens consumed by the model.
2. **Output Tokens (`tokens.output`)**: Normalized completion tokens produced by the model.
3. **Total Tokens (`tokens.total`)**: Canonical total tokens. If the source provider provides total tokens, it is recorded; otherwise, `tokens.input + tokens.output` is computed.
4. **Cached Input Tokens (`tokens.cached_input`)**: When a provider supports prompt caching (e.g. Anthropic prompt caching, OpenAI cached prompt tokens), tokens retrieved from cache are recorded explicitly under this key.
5. **Cache Creation Tokens (`tokens.cache_creation`)**: Tokens written to cache on cold prompt evaluation.
6. **Reasoning Tokens (`tokens.reasoning`)**: Extended thinking or reasoning tokens reported in model completion metadata (e.g. OpenAI o-series `reasoning_tokens`, Anthropic thinking budget tokens). **Only the numerical token count is recorded; raw reasoning traces are never captured.**
7. **Vector Embedding Tokens (`tokens.embedding`)**: Input tokens converted to vector space during embedding generation.
8. **Vector Count (`units.vectors`)**: Quantitative count of discrete vector embeddings generated in the operation or batch.
9. **Embedding Dimensions as Metadata (`dimensions.embedding_dimension`)**: The vector dimensionality (e.g. 1536, 3072) is a resource property and configuration characteristic, not a consumption unit. It must be captured in categorical `dimensions` (e.g. `dimensions.embedding_dimension = 1536`), never as a quantitative metric in `measurements`.

### 4.2 Handling Missing or Uneven Provider Metrics

- **Zero Invention Rule**: If an upstream model target does not report reasoning tokens, cached tokens, or compute duration, the Usage Service **must not invent, estimate, or assume values**. The corresponding measurement field remains `undefined`.
- **Provider-Neutral Identification**: The `resourceId` is **always** the canonical OICUNT model identifier (e.g. `oicunt.model.anthropic.claude-3-5-sonnet`), never an upstream vendor string (`claude-3-5-sonnet-20241022`). The upstream vendor target is captured solely as a categorical dimension (`dimensions.provider = 'anthropic'`).

---

## 5. Idempotency & Deduplication Engine

Because asynchronous message brokers (RabbitMQ) and distributed network protocols operate with **at-least-once delivery guarantees**, duplicate events will inevitably arrive at the Usage Service during network partitions, consumer crashes, or client retries.

### 5.1 Deduplication Key Invariants

1. Every usage event carries a deterministic `idempotencyKey`.
2. The idempotency key must be derived deterministically from the discrete runtime execution identity:
   - **Model Completion**: `mod_${requestId}_${dispatchAttempt}`
   - **Tool Execution**: `tool_${callId}`
   - **Embeddings Batch**: `emb_${batchId}`
   - **Agent Step**: `agent_${runId}_step_${stepNumber}`
   - **MCP Transport Session**: `mcp_sess_${sessionId}` _(for transport/session telemetry; delegated tool calls use `tool_${callId}` emitted exclusively by Tools Service)_
3. The combination of `(tenantId, idempotencyKey)` forms a globally unique natural key.

### 5.2 Deduplication Strategy & Persistence

```
Incoming UsageEvent
        │
        ▼
┌────────────────────────────────────────────────────────┐
│             Usage Ingestion Engine                     │
│   Checks PostgreSQL deduplication registry:            │
│   INSERT INTO usage_events (...)                       │
│   ON CONFLICT (tenant_id, idempotency_key) DO NOTHING  │
└───────────────────────┬────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
   [New Record]                 [Duplicate Record]
Persisted to database        Identified by ON CONFLICT
Enqueued for rollup          Silently acknowledged
Emitted to audit log         Zero double-counting
```

- **Durable Uniqueness**: In-memory deduplication (e.g. Redis LRU or process memory) is strictly prohibited as the authoritative deduplication mechanism. Deduplication is enforced directly by PostgreSQL unique constraints on `usage_events(tenant_id, idempotency_key)`.
- **Safe Re-delivery**: When a duplicate event is processed, PostgreSQL ignores the insertion (`DO NOTHING`). The consumer acknowledges the message from RabbitMQ and exits cleanly.

---

## 6. Immutable Historical Records & Corrections/Reversals

Usage records represent legal, financial, and compliance truth. They must be tamper-evident and immutable.

### 6.1 Immutability Invariants

1. **No Updates**: The `usage_events` table is strictly **append-only**. Executing `UPDATE` or `DELETE` on raw usage events is prohibited by database role privileges.
2. **Permanent Audit Trail**: Once written, a usage event represents an immutable snapshot of what was executed.

### 6.2 Corrections & Reversals Model

In the event of runtime failures requiring billing compensation (e.g. an upstream model connection dropped after partial output, or a tool execution crashed mid-flight after incurring partial compute):

1. **Explicit Reversal Events**: Corrections are executed by inserting a **new, discrete reversal event**:
   - `operation: 'usage.adjustment'` or `usage.reversal`
   - `dimensions.reversal_of_event_id: '<original_eventId>'`
   - `dimensions.reversal_reason: 'upstream_connection_aborted'`
2. **Signed Measurement Deltas**: The measurements on a reversal event specify negative deltas:
   - `measurements['tokens.input']: -1500`
   - `measurements['tokens.output']: -200`
3. **Mathematical Rollup Consistency**: Derived aggregates naturally reflect the correction upon summing, while preserving complete historical auditability of both the original consumption and the subsequent compensation.

---

## 7. Ingestion Architecture: Async-First Boundary

Runtime AI workloads must execute with low latency and high availability. To decouple runtime services from Usage Service latency, usage events are published asynchronously.

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Runtime Service (e.g. Tools)                     │
│   1. Completes tool execution                                          │
│   2. Asynchronously publishes UsageEvent to RabbitMQ                   │
│   3. Returns result to caller without blocking                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Non-blocking publish
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        RabbitMQ Event Exchange                         │
│   Exchange: oicunt.usage (Topic)                                       │
│   Routing Key: usage.v1.<sourceService>.<operation>                    │
│   Queue: oicunt.usage.events (Durable, Quorum)                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Controlled consumer rate
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Usage Ingestion Worker / Consumer                    │
│   1. Validates event schema                                            │
│   2. Idempotent insert into PostgreSQL                                 │
│   3. ACKs message only after durable commit                            │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.1 RabbitMQ Topology

| Component                | Identifier            | Type             | Attributes                                                  |
| :----------------------- | :-------------------- | :--------------- | :---------------------------------------------------------- |
| **Exchange**             | `oicunt.usage`        | Topic            | `durable: true`                                             |
| **Primary Queue**        | `oicunt.usage.events` | Quorum / Classic | `durable: true`, `x-dead-letter-exchange: oicunt.usage.dlx` |
| **Dead-Letter Exchange** | `oicunt.usage.dlx`    | Direct           | `durable: true`                                             |
| **Dead-Letter Queue**    | `oicunt.usage.dlq`    | Classic          | `durable: true`                                             |

### 7.2 Routing Key Taxonomy

Events use hierarchical routing keys for selective consumption:

```
usage.v1.<sourceService>.<operation>

Examples:
usage.v1.model-gateway.completion
usage.v1.embeddings.embed
usage.v1.tools.execution
usage.v1.agents.step
usage.v1.mcp.session
```

### 7.3 Direct Synchronous Ingestion Endpoint (Secondary)

For environments without message brokers or for trusted operational tools:

- `POST /internal/v1/usage/events`
- `POST /internal/v1/usage/events/batch`

Accepts authenticated `UsageEvent` payloads, validates them, and writes directly to PostgreSQL. This endpoint is secondary to the asynchronous RabbitMQ pipeline.

---

## 8. Persistence Architecture & Database Ownership

The Usage Service maintains strict ownership over its persistent data store in accordance with the OICUNT **Database-Per-Service Rule**.

### 8.1 Database Identity

- **Database Name**: `oicunt_usage`
- **Schema Name**: `oicunt_usage`
- **Isolation**: Zero shared tables with other microservices. Only the Usage Service possesses database credentials to connect to `oicunt_usage`.

### 8.2 Relational Schema Design

```sql
-- Authoritative Raw Usage Events
CREATE TABLE oicunt_usage.usage_events (
    event_id            UUID NOT NULL,
    schema_version      VARCHAR(16) NOT NULL,
    tenant_id           VARCHAR(64) NOT NULL,
    user_id             VARCHAR(64),
    actor_id            VARCHAR(64),
    product_id          VARCHAR(64) NOT NULL,
    source_service      VARCHAR(64) NOT NULL,
    operation           VARCHAR(64) NOT NULL,
    resource_id         VARCHAR(128) NOT NULL,
    measurements        JSONB NOT NULL,
    dimensions          JSONB NOT NULL DEFAULT '{}'::jsonb,
    lineage             JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key     VARCHAR(128) NOT NULL,
    occurred_at         TIMESTAMPTZ NOT NULL,
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_usage_events PRIMARY KEY (event_id, occurred_at),
    CONSTRAINT uq_usage_events_idempotency UNIQUE (tenant_id, idempotency_key)
);
-- Note: Declarative range-partitioning (e.g. PARTITION BY RANGE (occurred_at))
-- is a recommended production implementation strategy for high-volume deployments,
-- but is an implementation optimization rather than an irreversible architectural invariant.

-- Indexes for Tenant Queries and Lineage
CREATE INDEX idx_usage_events_tenant_time ON oicunt_usage.usage_events (tenant_id, occurred_at DESC);
CREATE INDEX idx_usage_events_resource ON oicunt_usage.usage_events (tenant_id, resource_id, occurred_at DESC);
CREATE INDEX idx_usage_events_correlation ON oicunt_usage.usage_events USING btree ((lineage->>'correlationId'));

-- Materialized Hourly Aggregates
CREATE TABLE oicunt_usage.usage_aggregates_hourly (
    bucket_start        TIMESTAMPTZ NOT NULL,
    tenant_id           VARCHAR(64) NOT NULL,
    product_id          VARCHAR(64) NOT NULL,
    source_service      VARCHAR(64) NOT NULL,
    resource_id         VARCHAR(128) NOT NULL,
    metric_name         VARCHAR(64) NOT NULL,
    metric_value        NUMERIC(20, 4) NOT NULL DEFAULT 0,
    event_count         BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_usage_aggregates_hourly PRIMARY KEY (
        bucket_start, tenant_id, product_id, source_service, resource_id, metric_name
    )
);

-- Materialized Daily Aggregates
CREATE TABLE oicunt_usage.usage_aggregates_daily (
    bucket_date         DATE NOT NULL,
    tenant_id           VARCHAR(64) NOT NULL,
    product_id          VARCHAR(64) NOT NULL,
    source_service      VARCHAR(64) NOT NULL,
    resource_id         VARCHAR(128) NOT NULL,
    metric_name         VARCHAR(64) NOT NULL,
    metric_value        NUMERIC(20, 4) NOT NULL DEFAULT 0,
    event_count         BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_usage_aggregates_daily PRIMARY KEY (
        bucket_date, tenant_id, product_id, source_service, resource_id, metric_name
    )
);
```

### 8.3 Persistence, Partitioning Strategy & Deferred Archival Policies

#### 8.3.1 PostgreSQL Raw Events as Authoritative Truth

The append-only `usage_events` table in PostgreSQL is the singular, authoritative source of truth for all platform operational consumption and financial audit trails. Derived rollups in `usage_aggregates_hourly` and `usage_aggregates_daily` are deterministic projections that can be dropped, recalculated, or backfilled from `usage_events` at any time.

#### 8.3.2 Partitioning as an Implementation Recommendation

Monthly range-partitioning by `occurred_at` (`PARTITION BY RANGE (occurred_at)`) is a **recommended production implementation pattern** for high-throughput deployments. Partitioning enables efficient partition pruning for tenant queries, localized index maintenance, and vacuum isolation.

However, monthly partitioning is explicitly **an implementation recommendation, not an irreversible architectural invariant**. Before empirical production volume, ingestion rates, and query profiles exist:

- The initial schema rollout may deploy as a standard unpartitioned table or adopt declarative monthly partitions based on operational readiness.
- Transitioning between unpartitioned and partitioned storage is an internal database maintenance decision that does not change the service contract, event schema, or HTTP/AMQP interfaces.

#### 8.3.3 Deferral of Cold Archival and Retention Policies

To maintain architectural discipline and avoid premature optimization before production telemetry is available:

1. **Cold Data Archival (Intentionally Deferred)**: Policies and automated jobs for offloading older partitions to cold object storage (e.g. Parquet files in S3/GCS or external lakehouse queries) are explicitly deferred until empirical storage growth rates and audit access patterns are measured.
2. **Aggregate and Raw Retention Horizons (Intentionally Deferred)**: Formal retention policies (e.g. retaining raw events for 90 days vs. 365 days; retaining daily rollups for 3 years vs. 7 years) are deferred until customer SLA contracts, compliance mandates (SOC 2, ISO 27001), and commercial financial guidelines are codified.

---

## 9. Aggregation Engine

Raw events represent fine-grained granularity. To serve fast queries to Billing, dashboards, and Entitlement monitors, the Usage Service maintains derived aggregations.

### 9.1 Derivation Rules

1. **Hourly Rollup**: Groups raw events into discrete 1-hour UTC buckets (`bucket_start = date_trunc('hour', occurred_at)`).
2. **Daily Rollup**: Groups hourly rollups into 1-day UTC buckets (`bucket_date = bucket_start::date`).
3. **Idempotent Rollup Updates**: Rollups are updated using transactional atomic upserts (`ON CONFLICT (bucket_start, tenant_id, ...) DO UPDATE SET metric_value = metric_value + EXCLUDED.metric_value`).
4. **Deterministic Re-aggregation**: If rollups ever diverge or require recalculation, they can be completely wiped and recomputed from raw `usage_events`.

---

## 10. Query & Read APIs

The Usage Service exposes internal, authenticated HTTP query endpoints for platform consumers.

### 10.1 `GET /internal/v1/usage/summary`

Returns consolidated consumption totals for a tenant across a specified time window.

- **Query Parameters**:
  - `tenantId` (string, required)
  - `startTime` (ISO 8601, required)
  - `endTime` (ISO 8601, required)
  - `productId` (string, optional)
  - `resourceId` (string, optional)
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "tenantId": "ten_enterprise_99",
      "window": {
        "startTime": "2026-10-01T00:00:00.000Z",
        "endTime": "2026-10-07T00:00:00.000Z"
      },
      "totals": {
        "tokens.input": 1542000,
        "tokens.output": 420500,
        "tokens.cached_input": 310000,
        "tokens.reasoning": 85000,
        "tokens.embedding": 2400000,
        "units.requests": 1420,
        "units.invocations": 612,
        "duration.compute_ms": 482000
      }
    }
  }
  ```

### 10.2 `GET /internal/v1/usage/timeseries`

Returns bucketed consumption metrics (hourly or daily) for charts, dashboards, and billing cycle calculations.

- **Query Parameters**:
  - `tenantId` (string, required)
  - `granularity` (`hourly` | `daily`, default `daily`)
  - `startTime` (ISO 8601, required)
  - `endTime` (ISO 8601, required)
  - `metric` (string, optional, e.g. `tokens.total`)
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "tenantId": "ten_enterprise_99",
      "granularity": "daily",
      "series": [
        {
          "bucket": "2026-10-01",
          "metrics": {
            "tokens.input": 220000,
            "tokens.output": 60000,
            "units.requests": 200
          }
        }
      ]
    }
  }
  ```

### 10.3 `GET /internal/v1/usage/events`

Returns paginated raw usage events for audit trails and deep inspection.

- **Query Parameters**:
  - `tenantId` (string, required)
  - `correlationId` (string, optional)
  - `resourceId` (string, optional)
  - `limit` (integer, default 50, max 200)
  - `cursor` (opaque pagination token)

---

## 11. Security & Privacy Posture

Usage metering operates under strict enterprise security constraints:

### 11.1 Tenant Boundary Isolation

- Ingestion and query paths are strictly isolated by `tenantId`.
- Cross-tenant aggregation is permitted only for internal system administrators with explicit platform-level roles (`system:admin`).
- Raw events from Tenant A are mathematically partitioned from Tenant B.

### 11.2 Trusted Ingestion Perimeter

- External clients (web browsers, mobile apps, MCP clients) are **strictly forbidden** from emitting usage events directly to the Usage Service or RabbitMQ.
- Only verified internal platform microservices bearing valid internal authentication credentials (`X-Internal-Token` / internal mutual TLS) may publish to `oicunt.usage` or invoke `POST /internal/v1/usage/events`.

### 11.3 Zero Sensitive Payload Rule

The Usage Service meters **consumption**, not **content**. Storing customer prompts or computational artifacts in the usage database is a critical privacy violation.

The following data types are **strictly prohibited** from `UsageEvent`:

1. **Raw Prompts & Completions**: User input text, chat history, and model responses.
2. **Raw Tool Arguments & Outputs**: Database queries, file contents, code scripts, API payloads.
3. **Credentials & Keys**: Upstream API keys, passwords, bearer tokens, confirmation tokens (`confirmationToken`).
4. **Vector Embeddings**: Raw embedding vector float arrays.

---

## 12. Failure Semantics & Resilience

| Failure Scenario                  | Behavior & Mitigation                                                                                                                                        |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RabbitMQ Queue Degraded**       | Emitting services employ in-memory ring buffers or fallback local structured logging. **Runtime model completion or tool execution proceeds without error.** |
| **Usage Service Database Outage** | Ingestion worker pauses acknowledgement (NACK with requeue); messages persist safely in RabbitMQ quorum queues until database recovers.                      |
| **Duplicate Event Ingestion**     | Recognized via `(tenant_id, idempotency_key)` unique constraint. Event is safely acknowledged and discarded without double-counting.                         |
| **Malformed Event Ingested**      | Event fails schema validation, is rejected without requeue, and routed directly to Dead-Letter Queue (`oicunt.usage.dlq`) with rejection telemetry.          |
| **Delayed / Out-of-Order Events** | Aggregation engine uses `occurredAt` (not `ingestedAt`) to attribute consumption to the correct historical hourly/daily bucket.                              |
| **Rollup Calculation Failure**    | Raw immutable events remain intact. Materialized rollups can be recalculated at any time via deterministic batch recalculation script.                       |

---

## 13. Integration Contracts Across OICUNT Services

Every runtime subsystem integrates with the Usage Service by emitting a standardized `UsageEvent` after operation completion:

### 13.1 Model Gateway (`services/model-gateway`)

- **Trigger**: Dispatched completion stream finishes or unary completion succeeds.
- **Source Service**: `model-gateway`
- **Operation**: `model.completion`
- **Resource ID**: Canonical model ID (e.g. `oicunt.model.anthropic.claude-3-5-sonnet`)
- **Measurements**: `tokens.input`, `tokens.output`, `tokens.total`, `tokens.cached_input`, `tokens.reasoning`, `duration.total_ms`, `units.requests = 1`.
- **Dimensions**: `provider`, `model_tier`, `finish_reason`.
- **Deduplication Key**: `mod_${requestId}_${dispatchAttempt}`

### 13.2 Embeddings Service (`services/embeddings`)

- **Trigger**: Vector embedding batch completes.
- **Source Service**: `embeddings`
- **Operation**: `model.embedding`
- **Resource ID**: Canonical embedding model ID (e.g. `oicunt.model.openai.text-embedding-3-small`)
- **Measurements**: `tokens.embedding`, `units.vectors`, `duration.total_ms`, `units.requests = 1`.
- **Dimensions**: `provider`, `model_name`, `embedding_dimension` (e.g. `1536`).
- **Deduplication Key**: `emb_${batchId}`
- _(Note: Embedding vector dimension length is a resource characteristic captured under `dimensions.embedding_dimension`, NOT a consumption unit under `measurements`)_.

### 13.3 Tools Service (`services/tools`)

- **Trigger**: Tool execution finishes (success or failure).
- **Source Service**: `tools`
- **Operation**: `tool.execution`
- **Resource ID**: Canonical tool ID (e.g. `oicunt.tool.python-interpreter`)
- **Measurements**: `units.invocations = 1`, `duration.total_ms`, `duration.compute_ms`, `network.egress_bytes`.
- **Dimensions**: `tool_category`, `is_error`, `execution_mode` (`sandbox` | `in_process` | `remote`), `ingress_channel` (e.g. `'internal'` | `'mcp_gateway'`).
- **Deduplication Key**: `tool_${callId}`
- **Authoritative Ingress Accounting**: When tool execution is invoked via the MCP Server Gateway, the Tools Service captures `dimensions.ingress_channel = 'mcp_gateway'` and inherits the client's `lineage.correlationId` and `lineage.requestId`. The Tools Service is the sole authoritative emitter for tool execution consumption.

### 13.4 Autonomous Agents (`services/agents`)

- **Trigger**: Agent step iteration completes or overall agent run terminates.
- **Source Service**: `agents`
- **Operation**: `agent.step` / `agent.run`
- **Resource ID**: Agent ID (e.g. `agent_researcher_v2`)
- **Measurements**: `units.steps = 1`, `duration.total_ms`.
- **Dimensions**: `agent_role`, `step_status`.
- **Deduplication Key**: `agent_${runId}_step_${stepNumber}`
- _(Note: Tool calls and model calls executed by the agent emit their own respective usage events from Tools and Model Gateway)_.

### 13.5 MCP Server Gateway (`services/mcp`)

The MCP Server Gateway exposes approved OICUNT Tools to external MCP clients over Streamable HTTP and stdio transports. Its usage metering contract strictly separates **transport telemetry** from **capability consumption**:

#### 13.5.1 Transport / Gateway Telemetry vs Capability Consumption

1. **Transport / Session Telemetry (Non-Billable Capability)**:
   - External client connection lifecycles, protocol handshakes, and transport session durations represent gateway connectivity telemetry, **not capability consumption**.
   - If emitted to the usage pipeline for operational auditing:
     - **Operation**: `mcp.session`
     - **Resource ID**: `oicunt.mcp.gateway`
     - **Measurements**: `duration.total_ms`, `units.requests = 1`.
     - **Dimensions**: `mcp_transport: 'streamable_http'`, `client_name`, `is_billable: false`.
     - **Deduplication Key**: `mcp_sess_${sessionId}`
2. **Capability Consumption (`tools/call` Delegation)**:
   - When an external MCP client invokes `tools/call`, the MCP Gateway validates perimeter authentication, resolves the canonical tool, and delegates execution directly to the **Tools Service** (`services/tools`).
   - The **Tools Service is the sole authoritative emitter** for the resulting `tool.execution` usage event.
   - **No Dual Measurement / No Double Billing**: The MCP Gateway must **NOT** emit a second or duplicate billable usage event (e.g. a redundant `mcp.call` or duplicate `tool.execution`) for delegated tool calls.

#### 13.5.2 Lineage and Correlation Across MCP Boundaries

To maintain end-to-end auditability and prevent duplicate measurement:

- **Trace Propagation**: The MCP Gateway propagates the external client request's `correlationId`, `requestId`, and generates a deterministic `callId` into the Tools Service invocation payload.
- **Lineage Attribution**: The Tools Service attaches these values directly to the usage event (`lineage.correlationId = correlationId`, `lineage.requestId = requestId`), sets `idempotencyKey = 'tool_${callId}'`, and tags `dimensions.ingress_channel = 'mcp_gateway'`.
- **Downstream Aggregation**: Downstream billing and aggregation pipelines process the single authoritative `tool.execution` event emitted by the Tools Service. Downstream billing rules never encounter duplicate MCP proxy records for the same capability execution.

### 13.6 Inference Service (`services/inference`)

- **Coordination**: Inference Service coordinates user-level request lifecycles. To prevent double-counting of raw tokens, **Model Gateway remains the authoritative emitter for LLM tokens**. Inference may optionally emit high-level user-turn orchestration metadata (`operation: 'inference.turn'`) with `units.requests = 1`.

---

## 14. Relationship with Downstream Systems

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Usage & Metering Service (ai-platform)                          │
│                                                                                        │
│                        Authoritative Answer: "What happened?"                          │
│                        • 1,500 input tokens, 400 output tokens                         │
│                        • 3,200 ms sandboxed Python compute                             │
│                        • 5 vector embeddings generated                                 │
└───────────────────┬────────────────────────────────┬───────────────────────────────────┘
                    │                                │
                    ▼                                ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
│        Billing (platform)            │  │          Entitlements (platform)             │
│                                      │  │                                              │
│ Authoritative Answer:                │  │ Authoritative Answer:                        │
│ "How much should it cost?"           │  │ "Is the tenant allowed to proceed?"          │
│ • Reads Usage via query API          │  │ • Queries current usage summaries            │
│ • Applies pricing plan ($0.003/1k)   │  │ • Compares against plan hard/soft quotas     │
│ • Invoices credit card or credits    │  │ • Returns allow/deny/throttle to ingress     │
└──────────────────────────────────────┘  └──────────────────────────────────────────────┘
```

---

## 15. Implementation Milestones (Future Roadmap)

When implementation is approved in future phases, the following artifacts will be constructed:

1. **`packages/usage-types`**: Pure TypeScript interfaces for `UsageEvent`, `UsageMeasurements`, and query DTOs.
2. **`services/usage`**: Hexagonal architecture microservice scafolded from `templates/service`.
3. **PostgreSQL Migrations**: `oicunt_usage` schema, `usage_events` (with recommended monthly range partitioning), and rollup tables.
4. **RabbitMQ Ingestion Worker**: High-throughput AMQP consumer with at-least-once deduplication and DLQ routing.
5. **Runtime Service Adapters**: Non-blocking usage emission helpers in `model-gateway`, `tools`, `embeddings`, `agents`, and `mcp`.
