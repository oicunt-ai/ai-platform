# OICUNT AI Platform Contract: Model Registry Implementation Specification

**Document Version**: 1.0.0  
**Status**: Authoritative Architectural & Implementation Contract  
**Classification**: Engineering Architecture Standard

---

## 1. Executive Summary & System Role

The **Model Registry** (`services/model-registry`) is the singular, authoritative **control-plane directory** for all AI models, capability configurations, context limits, pricing tables, and execution target mappings in the **OICUNT AI Platform**.

It provides deterministic resolution of public **Canonical Model Identifiers** (`oicunt.model.*`) into concrete, eligible execution targets and routing policies consumed by the **AI Orchestrator** and executed by the **Model Gateway**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI Orchestrator / BILLY                         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   │ 1. GET /internal/v1/models/resolve/:canonicalModelId
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Model Registry (Control Plane)                     │
│                                                                        │
│   Canonical Models • Versions • Targets • Policies • Aliases • Audit   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   │ 2. Returns Resolved Eligible Targets & Limits
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Model Gateway (Data Plane)                        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   │ 3. Dispatches via Provider Adapters (Egress)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Upstream LLM Model Providers                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Responsibilities & Invariants

### 2.1 What the Model Registry Owns

1. **Canonical OICUNT Model Identifiers**: Authoritative catalog of model families (`oicunt.model.general`, `oicunt.model.reasoning`, `oicunt.model.coding`, etc.).
2. **Model Versions**: Semantic version tracking and immutable release records (`v1.0.0`, `v1.2.0`).
3. **Model Metadata**: Display names, descriptions, and modality profiles (`text`, `image`, `audio`, `video`, `embedding`).
4. **Capabilities & Limit Profiles**: Feature flags (`streaming`, `toolCalling`, `structuredOutputs`, `reasoning`) and hard token bounds (`contextWindowTokens`, `maxOutputTokens`).
5. **Pricing Metadata**: Current input/output/cached token cost tables per million tokens.
6. **Availability Status**: Administrative lifecycle states (`available`, `degraded`, `maintenance`, `deprecated`).
7. **Model Aliases**: Dynamic pointers (`default`, `latest`, `preview`, `fast`) and tenant-specific overrides.
8. **Eligible Provider / Model Targets**: Approved mapping of canonical models to underlying vendor models (`provider`, `upstreamModelId`, `region`, `priority`, `weight`).
9. **Routing Policies**: Strategy rules (`priority-fallback`, `weighted-round-robin`, `lowest-latency`), max fallback counts, and degradation behaviors.
10. **Audit History**: Complete, tamper-evident ledger of every mutation to models, versions, targets, aliases, and policies.

### 2.2 Fundamental Architectural Invariants

> [!IMPORTANT]
> The following invariants are non-negotiable architectural constraints for the Model Registry:

1. **Zero Provider API Calls**: Model Registry **never** initiates network connections to upstream model providers (Anthropic, OpenAI, Google, AWS Bedrock).
2. **Zero Provider Credentials**: Model Registry **never** stores, reads, or possesses provider API keys, tokens, or IAM secrets. Provider credentials reside exclusively in Model Gateway provider adapters.
3. **Zero Provider SDK Dependencies**: Model Registry **never** imports vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`).
4. **Internal Upstream Identifiers**: Provider-specific model IDs (e.g. `claude-3-5-sonnet-20241022`, `gpt-4o-2024-08-06`) are strictly internal target data. They are never exposed to BILLY or external clients.
5. **Canonical Model IDs as Public Abstraction**: Only canonical identifiers (`oicunt.model.*`) are surfaced to client applications and orchestrators.
6. **Separation of What vs. How**: Model Registry decides **WHAT** model targets are eligible; Model Gateway decides **HOW** to execute against those eligible targets.
7. **Exclusive Database Ownership**: Model Registry owns its dedicated PostgreSQL database/schema. No database or table sharing with Model Gateway, Orchestrator, or any other service.
8. **Deterministic Resolution**: For any given effective configuration state, timestamp, and tenant context, resolution must produce the exact same deterministic target list and ordering.
9. **No Silent Leaks of Unavailable Targets**: Targets marked `maintenance` or `deprecated` must **never** be silently returned in active resolution responses.
10. **Full Auditability**: Every administrative mutation, status toggle, or routing policy update must generate an immutable audit log entry.

---

## 3. Domain Model & Aggregate Design

The Model Registry domain follows Domain-Driven Design (DDD). The **Canonical Model** is the primary **Aggregate Root**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                  CanonicalModel (Aggregate Root)                       │
│  id: CanonicalModelId ("oicunt.model.general")                         │
│  name: "General Intelligence"                                          │
│  description: "Frontier conversational and reasoning model"            │
│  activeVersion: "v1.2.0"                                               │
│  createdAt, updatedAt                                                  │
├────────────────────────────────────────────────────────────────────────┤
│  ├── ModelVersion (Entity, 1..*)                                       │
│  │     version: "v1.2.0"                                               │
│  │     modalities: [text, image]                                       │
│  │     capabilities: ModelCapabilities (Value Object)                  │
│  │     limits: ModelLimits (Value Object)                              │
│  │     pricing: ModelPricing (Value Object)                            │
│  │     status: AvailabilityStatus ("available")                        │
│  │     isImmutable: true                                               │
│  │                                                                     │
│  ├── ModelTarget (Entity, 1..*)                                        │
│  │     targetId: "target-anthropic-sonnet-us"                          │
│  │     provider: "anthropic" (ModelProviderType)                       │
│  │     upstreamModelId: "claude-3-5-sonnet-20241022"                   │
│  │     priority: 1                                                     │
│  │     weight: 100                                                     │
│  │     region: "us-east-1"                                             │
│  │     status: AvailabilityStatus ("available")                        │
│  │     supportsStreaming: true                                         │
│  │                                                                     │
│  ├── RoutingPolicy (Entity / Value Object, 1..1)                       │
│  │     strategy: "priority-fallback"                                   │
│  │     maxFallbackAttempts: 2                                          │
│  │     requireHealthyTarget: true                                      │
│  │     degradationBehavior: "fail-fast"                                │
│  │                                                                     │
│  └── ModelAlias (Entity, 0..*)                                         │
│        aliasName: "latest"                                             │
│        resolvedVersion: "v1.2.0"                                       │
│        tenantId?: string                                               │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Entity & Value Object Definitions

1. **`CanonicalModel` (Aggregate Root)**:
   - Owns global identity and consistency boundary for a model family.
   - Enforces uniqueness of versions, target priorities, and alias mappings within the model boundary.
2. **`ModelVersion` (Entity)**:
   - Represents an immutable snapshot of capabilities, limits, pricing, and modalities.
   - Once published and set to `active`, its limits and pricing are **immutable**.
3. **`ModelTarget` (Entity)**:
   - Represents an executable backend destination for a specific model version.
   - Binds vendor credentials indirectly via `provider` and internal `upstreamModelId`.
   - Maintains an independent `AvailabilityStatus` allowing operational cordoning of specific provider regions without deprecating the entire canonical model.
4. **`RoutingPolicy` (Entity / Value Object)**:
   - Governs target evaluation algorithms, traffic split percentages, fallback budgets, and failover behavior.
5. **`ModelAlias` (Entity)**:
   - Resolves dynamic or environment-specific pointers (e.g. `default`, `fast`, `staging`) to a concrete semantic `version`.
6. **`AvailabilityStatus` (Value Object / Enumeration)**:
   - `'available'`: Operational and accepting traffic.
   - `'degraded'`: Operational with known performance or latency degradation; eligible for low-priority routing.
   - `'maintenance'`: Operationally disabled; excluded from resolution responses.
   - `'deprecated'`: Retired model/version; returns descriptive deprecation errors upon resolution.

---

## 4. PostgreSQL Persistence Architecture & Schema Blueprint

The Model Registry strictly owns its persistence layer. It requires a dedicated PostgreSQL database schema (`model_registry`), completely isolated from any other service.

```
┌────────────────────────────────────────────────────────────────────────┐
│                  model_registry (PostgreSQL Schema)                    │
│                                                                        │
│  ┌──────────────────────┐        ┌──────────────────────┐              │
│  │   canonical_models   │───1:N──│    model_versions    │              │
│  └──────────┬───────────┘        └──────────┬───────────┘              │
│             │                               │                          │
│            1:N                             1:N                         │
│             │                               │                          │
│             ▼                               ▼                          │
│  ┌──────────────────────┐        ┌──────────────────────┐              │
│  │    model_aliases     │        │    model_targets     │              │
│  └──────────────────────┘        └──────────────────────┘              │
│             │                               │                          │
│            1:1                              │                          │
│             ▼                               ▼                          │
│  ┌──────────────────────┐        ┌──────────────────────┐              │
│  │   routing_policies   │        │     audit_events     │              │
│  └──────────────────────┘        └──────────────────────┘              │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Relational Table Specifications

#### 1. Table `canonical_models`

| Column           | Type           | Constraints              | Description                                              |
| ---------------- | -------------- | ------------------------ | -------------------------------------------------------- |
| `id`             | `VARCHAR(64)`  | `PRIMARY KEY`            | Canonical model identifier (e.g. `oicunt.model.general`) |
| `display_name`   | `VARCHAR(128)` | `NOT NULL`               | Human-readable name                                      |
| `description`    | `TEXT`         | `NOT NULL`               | Description of model capabilities                        |
| `active_version` | `VARCHAR(32)`  | `NOT NULL`               | Currently pinned active version (e.g. `v1.2.0`)          |
| `created_at`     | `TIMESTAMPTZ`  | `NOT NULL DEFAULT NOW()` | Record creation timestamp                                |
| `updated_at`     | `TIMESTAMPTZ`  | `NOT NULL DEFAULT NOW()` | Record last modification timestamp                       |

#### 2. Table `model_versions`

| Column               | Type                                   | Constraints                                | Description                                             |
| -------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `id`                 | `UUID`                                 | `PRIMARY KEY DEFAULT gen_random_uuid()`    | Unique version record ID                                |
| `canonical_model_id` | `VARCHAR(64)`                          | `NOT NULL REFERENCES canonical_models(id)` | Parent canonical model                                  |
| `version`            | `VARCHAR(32)`                          | `NOT NULL`                                 | Semantic version string (e.g. `v1.2.0`)                 |
| `modalities`         | `VARCHAR(32)[]`                        | `NOT NULL`                                 | Array of supported modalities (`text`, `image`, etc.)   |
| `capabilities`       | `JSONB`                                | `NOT NULL`                                 | Feature capabilities (`streaming`, `toolCalling`, etc.) |
| `limits`             | `JSONB`                                | `NOT NULL`                                 | Limits (`contextWindowTokens`, `maxOutputTokens`)       |
| `pricing`            | `JSONB`                                | `NOT NULL`                                 | Pricing structure per 1M tokens                         |
| `status`             | `VARCHAR(24)`                          | `NOT NULL DEFAULT 'available'`             | Lifecycle availability status                           |
| `is_immutable`       | `BOOLEAN`                              | `NOT NULL DEFAULT FALSE`                   | Immutability lock                                       |
| `created_at`         | `TIMESTAMPTZ`                          | `NOT NULL DEFAULT NOW()`                   | Version creation timestamp                              |
| `updated_at`         | `TIMESTAMPTZ`                          | `NOT NULL DEFAULT NOW()`                   | Version update timestamp                                |
| _Constraints_        | `UNIQUE (canonical_model_id, version)` |                                            | Unique semantic version per model                       |

#### 3. Table `model_targets`

| Column               | Type           | Constraints                              | Description                                                  |
| -------------------- | -------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `id`                 | `VARCHAR(64)`  | `PRIMARY KEY`                            | Unique target identifier (e.g. `target-anthropic-sonnet-us`) |
| `model_version_id`   | `UUID`         | `NOT NULL REFERENCES model_versions(id)` | Associated model version                                     |
| `provider`           | `VARCHAR(32)`  | `NOT NULL`                               | Upstream provider (`anthropic`, `openai`, `google`, etc.)    |
| `upstream_model_id`  | `VARCHAR(128)` | `NOT NULL`                               | Vendor model string (internal only)                          |
| `priority`           | `INT`          | `NOT NULL DEFAULT 1`                     | Failover order (1 = primary, 2 = secondary, etc.)            |
| `weight`             | `INT`          | `NOT NULL DEFAULT 100`                   | Traffic weight for identical priority targets                |
| `region`             | `VARCHAR(32)`  | `NULL`                                   | Deployment region identifier                                 |
| `adapter_options`    | `JSONB`        | `NULL`                                   | Non-secret adapter tuning parameters                         |
| `supports_streaming` | `BOOLEAN`      | `NOT NULL DEFAULT TRUE`                  | Server-Sent Events capability                                |
| `status`             | `VARCHAR(24)`  | `NOT NULL DEFAULT 'available'`           | Target operational health status                             |
| `max_concurrency`    | `INT`          | `NULL`                                   | Concurrency ceiling                                          |
| `created_at`         | `TIMESTAMPTZ`  | `NOT NULL DEFAULT NOW()`                 | Creation timestamp                                           |
| `updated_at`         | `TIMESTAMPTZ`  | `NOT NULL DEFAULT NOW()`                 | Update timestamp                                             |

#### 4. Table `routing_policies`

| Column                   | Type          | Constraints                                       | Description                 |
| ------------------------ | ------------- | ------------------------------------------------- | --------------------------- |
| `id`                     | `UUID`        | `PRIMARY KEY DEFAULT gen_random_uuid()`           | Policy identifier           |
| `canonical_model_id`     | `VARCHAR(64)` | `NOT NULL UNIQUE REFERENCES canonical_models(id)` | Parent canonical model      |
| `strategy`               | `VARCHAR(32)` | `NOT NULL DEFAULT 'priority-fallback'`            | Routing strategy            |
| `max_fallback_attempts`  | `INT`         | `NOT NULL DEFAULT 2`                              | Fallback attempt budget     |
| `require_healthy_target` | `BOOLEAN`     | `NOT NULL DEFAULT TRUE`                           | Circuit check requirement   |
| `degradation_behavior`   | `VARCHAR(32)` | `NOT NULL DEFAULT 'fail-fast'`                    | Graceful degradation policy |
| `created_at`             | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()`                          | Creation timestamp          |
| `updated_at`             | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()`                          | Update timestamp            |

#### 5. Table `model_aliases`

| Column               | Type                                                 | Constraints                                | Description                                     |
| -------------------- | ---------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `id`                 | `UUID`                                               | `PRIMARY KEY DEFAULT gen_random_uuid()`    | Alias identifier                                |
| `canonical_model_id` | `VARCHAR(64)`                                        | `NOT NULL REFERENCES canonical_models(id)` | Target canonical model                          |
| `alias_name`         | `VARCHAR(32)`                                        | `NOT NULL`                                 | Alias string (e.g. `latest`, `fast`, `preview`) |
| `target_version`     | `VARCHAR(32)`                                        | `NOT NULL`                                 | Semantic version pointed to                     |
| `tenant_id`          | `VARCHAR(64)`                                        | `NULL`                                     | Optional tenant override (NULL = global alias)  |
| `created_at`         | `TIMESTAMPTZ`                                        | `NOT NULL DEFAULT NOW()`                   | Creation timestamp                              |
| `updated_at`         | `TIMESTAMPTZ`                                        | `NOT NULL DEFAULT NOW()`                   | Update timestamp                                |
| _Constraints_        | `UNIQUE (canonical_model_id, alias_name, tenant_id)` |                                            | Deterministic alias mapping                     |

#### 6. Table `audit_events`

| Column           | Type          | Constraints                             | Description                                               |
| ---------------- | ------------- | --------------------------------------- | --------------------------------------------------------- |
| `id`             | `UUID`        | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique audit event ID                                     |
| `entity_type`    | `VARCHAR(32)` | `NOT NULL`                              | `canonical_model`, `version`, `target`, `alias`, `policy` |
| `entity_id`      | `VARCHAR(64)` | `NOT NULL`                              | Identifier of affected entity                             |
| `action`         | `VARCHAR(32)` | `NOT NULL`                              | `CREATE`, `UPDATE`, `STATUS_CHANGE`, `DEPRECATE`          |
| `actor_id`       | `VARCHAR(64)` | `NOT NULL`                              | Service identity or administrator ID                      |
| `correlation_id` | `VARCHAR(64)` | `NOT NULL`                              | Distributed correlation trace ID                          |
| `reason`         | `TEXT`        | `NULL`                                  | Change justification                                      |
| `before_state`   | `JSONB`       | `NULL`                                  | Snapshot prior to mutation                                |
| `after_state`    | `JSONB`       | `NOT NULL`                              | Snapshot following mutation                               |
| `created_at`     | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()`                | Immutable audit timestamp                                 |

---

## 5. Normalized Model Registry Resolution Pipeline

When the AI Orchestrator requests model resolution, the Model Registry executes a deterministic 7-step pipeline:

```
┌────────────────────────────────────────────────────────┐
│ 1. Parse Inbound Request & Correlation Context         │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 2. Canonical Model Lookup (Validate Model ID)          │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 3. Version & Alias Resolution (Tenant Override Check)  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 4. Availability State Validation (Check Kill-Switches) │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 5. Filter & Order Eligible Targets (Priority / Weight) │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 6. Attach Routing Policy, Limits & Pricing Metadata    │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 7. Return Deterministic ModelResolutionResponse        │
└────────────────────────────────────────────────────────┘
```

### Step Breakdown

1. **Inbound Validation**: Verifies that `canonicalModelId` adheres to format rules (`oicunt.model.*`) and extracts `X-Correlation-ID`.
2. **Canonical Model Lookup**: Queries `canonical_models`. If not found, immediately terminates with `404 MODEL_NOT_FOUND`.
3. **Version & Alias Resolution**:
   - If a specific version is requested (`v1.2.0`), resolves that version.
   - If an alias is provided (`latest` or `tenantId` override), resolves the alias to its pinned target version.
   - If omitted, resolves to `canonical_models.active_version`.
4. **Availability Filtering**:
   - If the resolved version is in `maintenance`, returns `503 MODEL_IN_MAINTENANCE`.
   - If the resolved version is `deprecated`, returns `410 MODEL_DEPRECATED`.
5. **Eligible Target Selection**:
   - Selects all `model_targets` linked to the resolved version where `status = 'available'` (or `'degraded'` if allowed by policy).
   - Targets in `maintenance` or `deprecated` are strictly excluded.
   - If zero eligible targets remain, returns `503 NO_ELIGIBLE_TARGETS`.
   - Targets are deterministically ordered by ascending `priority`, then descending `weight`, then target ID.
6. **Policy & Pricing Attachment**: Attaches the associated `RoutingPolicyConfig`, `ModelLimits`, and `ModelPricing` to the payload.
7. **Response Delivery**: Emits `ModelResolutionResponse` conforming to `docs/contracts/model-routing.md`.

---

## 6. API Boundaries & Internal Endpoint Contracts

All endpoints are strictly internal, authenticated service endpoints. The Model Registry does not expose public internet routes.

### 6.1 Hot Query Endpoints (High Throughput / Cached)

#### `GET /internal/v1/models/resolve/:canonicalModelId`

- **Purpose**: Fast resolution for AI Orchestrator and Model Gateway.
- **Query Parameters**:
  - `version` (optional, string): Request specific version or alias (e.g. `?version=v1.2.0` or `?version=latest`).
- **Headers**:
  - `X-Correlation-ID`: Required distributed trace ID.
  - `X-Tenant-ID`: Optional tenant identifier for alias overrides.
- **Success Response**: `200 OK` with `ModelResolutionResponse` envelope.
- **Error Responses**:
  - `404 MODEL_NOT_FOUND`: Canonical model identifier does not exist.
  - `404 VERSION_NOT_FOUND`: Requested version does not exist.
  - `410 MODEL_DEPRECATED`: Model version has been decommissioned.
  - `503 MODEL_IN_MAINTENANCE`: Model version is undergoing maintenance.
  - `503 NO_ELIGIBLE_TARGETS`: No active, healthy execution targets exist for this version.

#### `GET /internal/v1/models`

- **Purpose**: Lists all active canonical models in the catalog.
- **Response**: `200 OK` with `Array<CanonicalModelSummary>`.

#### `GET /internal/v1/models/:canonicalModelId`

- **Purpose**: Retrieves comprehensive model metadata, available versions, and aliases.
- **Response**: `200 OK` with `CanonicalModelDetail`.

---

### 6.2 Administrative Control-Plane Endpoints (Mutations / Protected)

All mutation endpoints require write authorization and mandate a reason for audit logging.

| Endpoint                                                         | Method | Purpose                                                                | Mandatory Headers / Body                               |
| ---------------------------------------------------------------- | :----: | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `/internal/v1/models`                                            | `POST` | Registers a new canonical model                                        | `CreateCanonicalModelRequest`, `X-Actor-ID`            |
| `/internal/v1/models/:canonicalModelId/versions`                 | `POST` | Publishes a new semantic model version                                 | `CreateModelVersionRequest`, `X-Actor-ID`              |
| `/internal/v1/models/:canonicalModelId/versions/:version/status` | `PUT`  | Updates availability status (`available`, `maintenance`, `deprecated`) | `UpdateStatusRequest`, `X-Actor-ID`, `X-Change-Reason` |
| `/internal/v1/models/:canonicalModelId/targets`                  | `POST` | Adds an execution target to a version                                  | `CreateModelTargetRequest`, `X-Actor-ID`               |
| `/internal/v1/models/:canonicalModelId/targets/:targetId/status` | `PUT`  | Cordon / uncordon a specific target                                    | `UpdateTargetStatusRequest`, `X-Actor-ID`              |
| `/internal/v1/models/:canonicalModelId/routing-policy`           | `PUT`  | Updates routing policy configuration                                   | `UpdateRoutingPolicyRequest`, `X-Actor-ID`             |
| `/internal/v1/models/:canonicalModelId/aliases`                  | `PUT`  | Updates or binds a model alias                                         | `SetModelAliasRequest`, `X-Actor-ID`                   |

---

## 7. Security, Authorization & Service Identity

1. **Zero Provider Secrets**: The Model Registry database and application memory contain zero upstream provider secrets (no Anthropic, OpenAI, or Google keys).
2. **mTLS / Service Mesh Identity**: Inbound connections require mutual TLS (mTLS) with cryptographically verified service identities.
3. **Role-Based Service Authorization (RBAC)**:
   - **`ai-orchestrator`**: Granted `models:read` and `models:resolve` only.
   - **`model-gateway`**: Granted `models:read` and `models:resolve` only.
   - **`ai-platform-admin`**: Granted `models:*` (read, write, status-toggle, alias-bind).
4. **Authoritative Identity Forwarding**: Inbound requests must propagate `X-Correlation-ID`. Identity headers (`X-User-ID`, `X-Tenant-ID`) are trusted only when signed by the internal mesh perimeter.

---

## 8. Caching Strategy & Operational Resilience

To maintain ultra-low latency (<2ms) and decouple runtime inference from database query load, the Model Registry implements a multi-tier caching strategy:

```
┌─────────────────────────────────┐
│         AI Orchestrator         │ ──► [Local L1 Cache] (Memory, TTL: 60s)
└────────────────┬────────────────┘
                 │ (Cache Miss)
                 ▼
┌─────────────────────────────────┐
│     Model Registry Service      │ ──► [Service L2 Cache] (Memory/Redis, TTL: 300s)
└────────────────┬────────────────┘
                 │ (Cache Miss)
                 ▼
┌─────────────────────────────────┐
│     PostgreSQL (Persistence)    │
└─────────────────────────────────┘
```

### 8.1 Caching Specifications

1. **What May Be Cached**:
   - `ModelResolutionResponse` objects keyed by `${canonicalModelId}:${version}:${tenantId}`.
   - Canonical model catalog listings (`GET /internal/v1/models`).
2. **Cache Invalidation Mechanics**:
   - **Event-Driven Invalidation**: Mutations to versions, targets, aliases, or routing policies emit internal domain events (`model.version.updated`, `model.target.cordoned`, `model.alias.changed`).
   - The registry evicts corresponding keys across L2 caches immediately upon event publication.
3. **Stale Data Tolerance**:
   - In the event of a transient PostgreSQL network partition, the registry may serve cached resolution responses for up to `300 seconds` (stale-while-revalidate).
   - **Exception**: Explicit administrative transitions to `maintenance` or `deprecated` status force an immediate cache purge across all tiers to act as an instant emergency kill-switch.
4. **Registry Unavailability Fallback**:
   - If the Model Registry becomes completely unreachable, consuming services (Orchestrator and Model Gateway) utilize their local consumer-side cache (configurable default TTL: `60s`) to sustain in-flight traffic.

---

## 9. Versioning & Immutability Rules

1. **Semantic Versioning**: All model versions conform to `vMAJOR.MINOR.PATCH` (e.g. `v1.0.0`, `v1.2.0`).
2. **Immutability of Published Versions**:
   - Once a `ModelVersion` is published and marked `active`, its core specifications (`capabilities`, `limits`, `pricing`, `modalities`) become **strictly immutable**.
   - If pricing changes or context window limits expand upstream, a new semantic version (e.g. `v1.3.0`) must be published.
3. **Optimistic Locking**: All mutation entities contain a `version` lock column to prevent lost updates during concurrent administrative changes.

---

## 10. Audit Logging & Governance Specification

Every state modification creates an immutable row in `model_registry.audit_events`.

### Required Audit Fields

```typescript
export interface ModelRegistryAuditEvent {
  readonly auditId: string;
  readonly entityType:
    'canonical_model' | 'model_version' | 'model_target' | 'model_alias' | 'routing_policy';
  readonly entityId: string;
  readonly action: 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'DELETE' | 'DEPRECATE';
  readonly actorId: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly reason?: string;
  readonly beforeState?: Record<string, unknown>;
  readonly afterState: Record<string, unknown>;
}
```

Audit entries are append-only; update and delete operations on the audit table are disabled at the PostgreSQL permission layer.

---

## 11. Validation Rules & Canonical Error Taxonomy

### 11.1 Input Validation Rules

- `canonicalModelId`: Must match regex `^oicunt\.model\.[a-z0-9\-]+$` (e.g. `oicunt.model.general`).
- `version`: Must match SemVer format `^v?[0-9]+\.[0-9]+\.[0-9]+$`.
- `targetWeights`: Target weights for targets sharing the same priority must sum to a positive integer (typically `100`).
- `limits`: `contextWindowTokens` and `maxOutputTokens` must be strictly positive integers (`> 0`).
- `pricing`: Token rates must be non-negative floats (`>= 0.0`).
- `upstreamModelId`: Cannot be empty or contain whitespace.

### 11.2 Error Code Taxonomy

| Error Code                    | HTTP Status | Trigger Condition                                                |
| ----------------------------- | :---------: | ---------------------------------------------------------------- |
| `MODEL_NOT_FOUND`             |     404     | Canonical model ID does not exist in catalog                     |
| `VERSION_NOT_FOUND`           |     404     | Requested version or alias does not exist                        |
| `MODEL_DEPRECATED`            |     410     | Model version is permanently retired                             |
| `MODEL_IN_MAINTENANCE`        |     503     | Model version is temporarily offline for maintenance             |
| `NO_ELIGIBLE_TARGETS`         |     503     | No targets are in `available` state for this version             |
| `INVALID_ROUTING_POLICY`      |     400     | Target priorities, weights, or strategy parameters violate rules |
| `ALIAS_CYCLE_DETECTED`        |     400     | Alias points to another alias forming a circular loop            |
| `IMMUTABLE_VERSION_VIOLATION` |     409     | Attempted mutation of an immutable published version             |

---

## 12. Testing Boundaries & Verification Strategy

Future implementation of `services/model-registry` must be validated against 5 isolated testing tiers:

```
┌────────────────────────────────────────────────────────┐
│ 1. Domain Tests (Aggregate invariants, status states)  │
├────────────────────────────────────────────────────────┤
│ 2. Application Tests (Use cases, resolution pipeline)  │
├────────────────────────────────────────────────────────┤
│ 3. Persistence Tests (PostgreSQL schema, transactions) │
├────────────────────────────────────────────────────────┤
│ 4. HTTP API Tests (Routes, middleware, health probes)  │
├────────────────────────────────────────────────────────┤
│ 5. Resolution Determinism Tests (Priority/Weight/Sort) │
└────────────────────────────────────────────────────────┘
```

1. **Domain Tests (`tests/unit/domain/`)**:
   - Validates `CanonicalModel` aggregate invariants.
   - Tests alias resolution logic and detects circular alias chains.
   - Enforces immutability transitions on `ModelVersion`.
2. **Application Tests (`tests/unit/application/`)**:
   - Tests `ResolveModelUseCase` with in-memory repository doubles.
   - Verifies target filtering under `degraded` and `maintenance` conditions.
   - Tests cache key generation and eviction dispatch.
3. **Persistence Tests (`tests/integration/persistence/`)**:
   - Verifies PostgreSQL schema constraints, foreign key cascades, and unique indexes using test containers.
   - Validates optimistic concurrency locking under parallel updates.
   - Verifies append-only audit event persistence.
4. **API Tests (`tests/integration/interfaces/`)**:
   - Validates `/internal/v1/models/resolve/:id` against wire contracts.
   - Verifies that `/healthz` and `/readyz` reflect database connectivity.
   - Tests extraction and response reflection of `X-Correlation-ID`.
5. **Resolution Determinism Tests (`tests/contract/`)**:
   - Runs parameterized property-based tests verifying that identical inputs yield identical ordered target arrays across multiple sequential queries.

---

## 13. Architectural Compliance Checklist

Before declaring the Model Registry service production-ready in future milestones, verify:

- [ ] Model Registry exclusively owns the `model_registry` PostgreSQL schema.
- [ ] No database connections or tables are shared with Model Gateway or Orchestrator.
- [ ] Model Registry contains zero provider SDKs, provider credentials, or outbound provider HTTP calls.
- [ ] Inbound requests authenticate via internal mTLS service identity.
- [ ] Resolution pipeline strictly executes the 7-step deterministic resolution algorithm.
- [ ] Inactive, maintenance, or deprecated targets are never returned in eligible target arrays.
- [ ] All mutations write an immutable audit log entry to `audit_events`.
- [ ] Resolution responses strictly conform to `ModelResolutionResponse` in `docs/contracts/model-routing.md`.
