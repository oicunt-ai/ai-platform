# OICUNT AI Platform Contract: Model Registry Implementation Specification

**Document Version**: 1.1.0  
**Status**: Authoritative Architectural & Implementation Contract  
**Classification**: Engineering Architecture Standard

---

## 1. Executive Summary & System Role

The **Model Registry** (`services/model-registry`) is the singular, authoritative **control-plane directory** for all AI models, capability configurations, context limits, pricing tables, and execution target mappings in the **OICUNT AI Platform**.

It serves two primary operational roles:

1. **Dynamic Model Catalog Provider for Client Applications (Model Selection)**: Exposes a user-facing, sanitized model catalog (`GET /internal/v1/catalog`) consumed by BILLY and client orchestrators to render dynamic model pickers (e.g. Claude Sonnet, Claude Opus, GPT-4o, Gemini Pro) and dynamic reasoning effort selectors (`low`, `medium`, `high`).
2. **Deterministic Model Resolution Authority (Model Resolution)**: Deterministically resolves user-selected canonical models and optional effort levels into concrete, eligible execution targets, token limits, and routing policies consumed by the **AI Orchestrator** and executed by the **Model Gateway** (see [Model Gateway Contract](./model-gateway.md) and [AI Orchestrator Contract](./ai-orchestrator.md)).

```
┌────────────────────────────────────────────────────────────────────────────┐
│                  Platform API Gateway / Perimeter Ingress                  │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              AI Orchestrator                               │
└──────────────────┬───────────────────────────────────────┬─────────────────┘
                   │                                       │
     (Control Plane Resolution)               (Runtime Execution Coordination)
  1. GET /internal/v1/models/resolve/:id                   │
  2. ModelResolutionResponse                               │ 3. Execute
                   ▼                                       ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────┐
│    Model Registry (Control Plane)    │  │ Inference Service (Runtime Plane)│
│                                      │  └────────────────┬─────────────────┘
│ Canonical Models • Versions • Targets│                   │ 4. Dispatch
│ Policies • Limits • Pricing Tables   │                   ▼
└──────────────────────────────────────┘  ┌──────────────────────────────────┐
                                          │    Model Gateway (Data Plane)    │
                                          │   (Circuit Breakers, Retries)    │
                                          └────────────────┬─────────────────┘
                                                           │ 5. Invoke Adapter
                                                           ▼
                                          ┌──────────────────────────────────┐
                                          │ Provider Adapter (Internal ACL)  │
                                          └────────────────┬─────────────────┘
                                                           │ 6. Wire Protocol
                                                           ▼
                                          ┌──────────────────────────────────┐
                                          │   Upstream LLM Model Providers   │
                                          └──────────────────────────────────┘
```

---

## 2. Core Responsibilities & Invariants

### 2.1 What the Model Registry Owns

1. **User-Facing Canonical Model Identifiers**: Authoritative catalog of model families and user-selectable models (`claude-sonnet`, `claude-opus`, `claude-haiku`, `gpt-4o`, `gemini-pro`, as well as namespaced identifiers like `oicunt.model.general`).
2. **Model Family Grouping**: Categorization by underlying model lineage (`claude`, `gpt`, `gemini`, etc.).
3. **Model Selection vs. Model Resolution Separation**:
   - **Model Selection**: Client/BILLY querying the dynamic catalog to present user options without exposing provider targets or secrets.
   - **Model Resolution**: OICUNT determining eligible execution endpoints and applying routing rules.
4. **Effort & Reasoning Governance**: Dynamic validation of reasoning effort parameters (`low`, `medium`, `high`) against declared model capabilities.
5. **Model Versions**: Semantic version tracking and immutable release records (`v1.0.0`, `v1.2.0`).
6. **Model Metadata**: Display names, descriptions, and modality profiles (`text`, `image`, `audio`, `video`, `embedding`).
7. **Capabilities & Limit Profiles**: Feature flags (`streaming`, `toolCalling`, `structuredOutputs`, `reasoning`), supported effort levels (`supportedEffortLevels`, `defaultEffortLevel`), and hard token bounds (`contextWindowTokens`, `maxOutputTokens`).
8. **Pricing Metadata**: Current input/output/cached token cost tables per million tokens.
9. **Availability Status**: Administrative lifecycle states (`available`, `degraded`, `maintenance`, `deprecated`).
10. **Model Aliases**: Dynamic pointers (`default`, `latest`, `preview`, `fast`) and tenant-specific overrides.
11. **Eligible Provider / Model Targets**: Approved mapping of canonical models to underlying vendor models (`provider`, `upstreamModelId`, `region`, `priority`, `weight`).
12. **Transparent Provider Replacement**: Support for multiple provider targets per model version (e.g. Anthropic direct + AWS Bedrock fallback), enabling transparent target cordoning and failover without changing the user-selected model.
13. **Routing Policies**: Strategy rules (`priority-fallback`, `weighted-round-robin`, `lowest-latency`), max fallback counts, and degradation behaviors.
14. **Audit History**: Complete, tamper-evident ledger of every mutation to models, versions, targets, aliases, and policies.

### 2.2 Fundamental Architectural Invariants

> [!IMPORTANT]
> The following invariants are non-negotiable architectural constraints for the Model Registry:

1. **Zero Provider API Calls**: Model Registry **never** initiates network connections to upstream model providers (Anthropic, OpenAI, Google, AWS Bedrock).
2. **Zero Provider Credentials**: Model Registry **never** stores, reads, or possesses provider API keys, tokens, or IAM secrets. Provider credentials reside exclusively in Model Gateway provider adapters.
3. **Zero Provider SDK Dependencies**: Model Registry **never** imports vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`).
4. **Internal Upstream Identifiers**: Provider-specific model IDs (e.g. `claude-3-5-sonnet-20241022`, `gpt-4o-2024-08-06`) are strictly internal target data. They are never exposed to BILLY or external clients.
5. **Effort is a Parameter, Not a Model Identity**: Reasoning effort levels (`low`, `medium`, `high`) are model capabilities and runtime request parameters, never separate canonical models.
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
│  id: CanonicalModelId ("claude-sonnet" | "gpt-4o")                     │
│  name: "Claude Sonnet"                                                 │
│  description: "Balanced frontier reasoning and coding"                 │
│  family: "claude"                                                      │
│  activeVersion: "v1.0.0"                                               │
│  createdAt, updatedAt                                                  │
├────────────────────────────────────────────────────────────────────────┤
│  ├── ModelVersion (Entity, 1..*)                                       │
│  │     version: "v1.0.0"                                               │
│  │     modalities: [text, image]                                       │
│  │     capabilities: ModelCapabilities (Value Object)                  │
│  │       ├── reasoning: true                                           │
│  │       ├── supportedEffortLevels: ["low", "medium", "high"]          │
│  │       └── defaultEffortLevel: "medium"                              │
│  │     limits: ModelLimits (Value Object)                              │
│  │     pricing: ModelPricing (Value Object)                            │
│  │     status: AvailabilityStatus ("available")                        │
│  │     isImmutable: true                                               │
│  │                                                                     │
│  ├── ModelTarget (Entity, 1..*)                                        │
│  │     targetId: "target-anthropic-direct"                             │
│  │     provider: "anthropic" (ModelProviderType)                       │
│  │     upstreamModelId: "claude-3-5-sonnet-20241022"                   │
│  │     priority: 1                                                     │
│  │     weight: 100                                                     │
│  │     status: AvailabilityStatus ("available")                        │
│  │                                                                     │
│  │     targetId: "target-bedrock-fallback"                             │
│  │     provider: "bedrock" (ModelProviderType)                         │
│  │     upstreamModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0"    │
│  │     priority: 2                                                     │
│  │     weight: 100                                                     │
│  │     status: AvailabilityStatus ("available")                        │
│  │                                                                     │
│  ├── RoutingPolicy (Entity / Value Object, 1..1)                       │
│  │     strategy: "priority-fallback"                                   │
│  │     maxFallbackAttempts: 2                                          │
│  │                                                                     │
│  └── ModelAlias (Entity, 0..*)                                         │
│        aliasName: "latest"                                             │
│        resolvedVersion: "v1.0.0"                                       │
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

| Column           | Type           | Constraints              | Description                                                               |
| ---------------- | -------------- | ------------------------ | ------------------------------------------------------------------------- |
| `id`             | `VARCHAR(64)`  | `PRIMARY KEY`            | Canonical model identifier (e.g. `claude-sonnet`, `oicunt.model.general`) |
| `display_name`   | `VARCHAR(128)` | `NOT NULL`               | Human-readable name (e.g. `Claude Sonnet`)                                |
| `description`    | `TEXT`         | `NOT NULL`               | Description of model capabilities                                         |
| `family`         | `VARCHAR(64)`  | `NULL`                   | Model family grouping (e.g. `claude`, `gpt`, `gemini`)                    |
| `active_version` | `VARCHAR(32)`  | `NOT NULL`               | Currently pinned active version (e.g. `v1.0.0`)                           |
| `created_at`     | `TIMESTAMPTZ`  | `NOT NULL DEFAULT NOW()` | Record creation timestamp                                                 |
| `updated_at`     | `TIMESTAMPTZ`  | `NOT NULL DEFAULT NOW()` | Record last modification timestamp                                        |

#### 2. Table `model_versions`

| Column               | Type                                   | Constraints                                | Description                                                                                                   |
| -------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `id`                 | `UUID`                                 | `PRIMARY KEY DEFAULT gen_random_uuid()`    | Unique version record ID                                                                                      |
| `canonical_model_id` | `VARCHAR(64)`                          | `NOT NULL REFERENCES canonical_models(id)` | Parent canonical model                                                                                        |
| `version`            | `VARCHAR(32)`                          | `NOT NULL`                                 | Semantic version string (e.g. `v1.0.0`)                                                                       |
| `modalities`         | `VARCHAR(32)[]`                        | `NOT NULL`                                 | Array of supported modalities (`text`, `image`, etc.)                                                         |
| `capabilities`       | `JSONB`                                | `NOT NULL`                                 | Feature capabilities (`streaming`, `toolCalling`, `reasoning`, `supportedEffortLevels`, `defaultEffortLevel`) |
| `limits`             | `JSONB`                                | `NOT NULL`                                 | Limits (`contextWindowTokens`, `maxOutputTokens`)                                                             |
| `pricing`            | `JSONB`                                | `NOT NULL`                                 | Pricing structure per 1M tokens                                                                               |
| `status`             | `VARCHAR(24)`                          | `NOT NULL DEFAULT 'available'`             | Lifecycle availability status                                                                                 |
| `is_immutable`       | `BOOLEAN`                              | `NOT NULL DEFAULT FALSE`                   | Immutability lock                                                                                             |
| `created_at`         | `TIMESTAMPTZ`                          | `NOT NULL DEFAULT NOW()`                   | Version creation timestamp                                                                                    |
| `updated_at`         | `TIMESTAMPTZ`                          | `NOT NULL DEFAULT NOW()`                   | Version update timestamp                                                                                      |
| _Constraints_        | `UNIQUE (canonical_model_id, version)` |                                            | Unique semantic version per model                                                                             |

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

When the AI Orchestrator requests model resolution, the Model Registry executes a deterministic 8-step pipeline:

```
┌────────────────────────────────────────────────────────┐
│ 1. Parse Inbound Request, Correlation & Effort Context │
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
│ 5. Reasoning Effort Validation (Capabilities Check)   │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 6. Filter & Order Eligible Targets (Priority / Weight) │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 7. Attach Routing Policy, Limits & Pricing Metadata    │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 8. Return Deterministic ModelResolutionResponse        │
└────────────────────────────────────────────────────────┘
```

### Step Breakdown

1. **Inbound Validation**: Verifies that `canonicalModelId` adheres to format rules (`/^[a-z0-9][a-z0-9._-]{1,63}$/`), extracts `X-Correlation-ID`, and parses optional `effort` parameter.
2. **Canonical Model Lookup**: Queries `canonical_models`. If not found, immediately terminates with `404 MODEL_NOT_FOUND`.
3. **Version & Alias Resolution**:
   - If a specific version is requested (`v1.0.0`), resolves that version.
   - If an alias is provided (`latest` or `tenantId` override), resolves the alias to its pinned target version.
   - If omitted, resolves to `canonical_models.active_version`.
4. **Availability Filtering**:
   - If the resolved version is in `maintenance`, returns `503 MODEL_IN_MAINTENANCE`.
   - If the resolved version is `deprecated`, returns `410 MODEL_DEPRECATED`.
5. **Reasoning Effort Validation**:
   - If `effort` is specified in the request:
     - Verifies that the resolved version's `capabilities.reasoning` is `true`. If not, returns `400 UNSUPPORTED_EFFORT_LEVEL`.
     - Verifies that the requested effort is included in `capabilities.supportedEffortLevels`. If not, returns `400 UNSUPPORTED_EFFORT_LEVEL`.
   - If `effort` is omitted but the model supports effort (`capabilities.supportedEffortLevels` defined), automatically defaults to `capabilities.defaultEffortLevel` (or `'medium'`).
   - If the model does not support reasoning effort, `effort` remains `undefined`.
6. **Eligible Target Selection**:
   - Selects all `model_targets` linked to the resolved version where `status = 'available'` (or `'degraded'` if allowed by policy).
   - Targets in `maintenance` (cordoned) or `deprecated` are strictly excluded.
   - Transparent Provider Replacement: Outages or maintenance cordoning of a primary target (e.g. Anthropic direct) allow seamless failover to secondary targets (e.g. AWS Bedrock) without changing the user's selected canonical model.
   - If zero eligible targets remain, returns `503 NO_ELIGIBLE_TARGETS`.
   - Targets are deterministically ordered by ascending `priority`, then descending `weight`, then target ID.
7. **Policy & Pricing Attachment**: Attaches the associated `RoutingPolicyConfig`, `ModelLimits`, `ModelPricing`, and effective `effort` to the payload.
8. **Response Delivery**: Emits `ModelResolutionResponse` conforming to `docs/contracts/model-routing.md`.

---

## 6. API Boundaries & Internal Endpoint Contracts

All endpoints are strictly internal, authenticated service endpoints. The Model Registry does not expose public internet routes.

### 6.1 Hot Query Endpoints (High Throughput / Cached)

#### `GET /internal/v1/catalog`

- **Purpose**: Dynamic model catalog discovery for BILLY and client model selectors. Returns user-facing model options without exposing internal provider targets, weights, or secrets.
- **Query Parameters**:
  - `selectableOnly` (optional, boolean, default `true`): If `true`, returns only models whose active version is in `available` status.
  - `family` (optional, string): Filters catalog entries by model family (e.g. `?family=claude` or `?family=gpt`).
- **Success Response**: `200 OK` with `Array<ModelCatalogEntry>`.
- **Response Entry Shape**:
  ```typescript
  export interface ModelCatalogEntry {
    readonly id: string;
    readonly displayName: string;
    readonly description: string;
    readonly family?: string;
    readonly modalities: readonly ModelModality[];
    readonly capabilities: ModelCapabilities;
    readonly isReasoning: boolean;
    readonly supportedEffortLevels?: readonly ReasoningEffortLevel[];
    readonly defaultEffortLevel?: ReasoningEffortLevel;
    readonly limits: ModelLimits;
    readonly pricing: ModelPricing;
    readonly status: ModelAvailabilityStatus;
    readonly activeVersion: string;
  }
  ```

#### `GET /internal/v1/models/resolve/:canonicalModelId`

- **Purpose**: Fast resolution for AI Orchestrator and Model Gateway.
- **Query Parameters**:
  - `version` (optional, string): Request specific version or alias (e.g. `?version=v1.0.0` or `?version=latest`).
  - `effort` (optional, string): Request specific reasoning effort level (`low`, `medium`, `high`).
- **Headers**:
  - `X-Correlation-ID`: Required distributed trace ID.
  - `X-Tenant-ID`: Optional tenant identifier for alias overrides.
- **Success Response**: `200 OK` with `ModelResolutionResponse` envelope including `effort` and `family`.
- **Error Responses**:
  - `400 UNSUPPORTED_EFFORT_LEVEL`: Model does not support reasoning effort or requested effort level is not supported.
  - `404 MODEL_NOT_FOUND`: Canonical model identifier does not exist.
  - `404 VERSION_NOT_FOUND`: Requested version does not exist.
  - `410 MODEL_DEPRECATED`: Model version has been decommissioned.
  - `503 MODEL_IN_MAINTENANCE`: Model version is undergoing maintenance.
  - `503 NO_ELIGIBLE_TARGETS`: No active, healthy execution targets exist for this version.

#### `GET /internal/v1/models`

- **Purpose**: Lists all canonical models in the administrative catalog (summaries).
- **Response**: `200 OK` with `Array<CanonicalModelSummary>`.

#### `GET /internal/v1/models/:canonicalModelId`

- **Purpose**: Retrieves comprehensive administrative model metadata, available versions, and aliases.
- **Response**: `200 OK` with `CanonicalModelDetail`.

---

### 6.2 Administrative Control-Plane Endpoints (Mutations / Protected)

All mutation endpoints require write authorization (`ai-platform-admin`) and mandate an actor and audit logging.

| Endpoint                                                         | Method | Purpose                                                                | Mandatory Headers / Body                               |
| ---------------------------------------------------------------- | :----: | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `/internal/v1/models`                                            | `POST` | Registers a new canonical model (with optional `family`)               | `CreateCanonicalModelRequest`, `X-Actor-ID`            |
| `/internal/v1/models/:canonicalModelId/versions`                 | `POST` | Publishes a new semantic model version                                 | `CreateModelVersionRequest`, `X-Actor-ID`              |
| `/internal/v1/models/:canonicalModelId/versions/:version/status` | `PUT`  | Updates availability status (`available`, `maintenance`, `deprecated`) | `UpdateStatusRequest`, `X-Actor-ID`, `X-Change-Reason` |
| `/internal/v1/models/:canonicalModelId/targets`                  | `POST` | Adds an execution target to a version                                  | `CreateModelTargetRequest`, `X-Actor-ID`               |
| `/internal/v1/models/:canonicalModelId/targets/:targetId/status` | `PUT`  | Cordon / uncordon a specific target (enables failover)                 | `UpdateTargetStatusRequest`, `X-Actor-ID`              |
| `/internal/v1/models/:canonicalModelId/routing-policy`           | `PUT`  | Updates routing policy configuration                                   | `UpdateRoutingPolicyRequest`, `X-Actor-ID`             |
| `/internal/v1/models/:canonicalModelId/aliases`                  | `PUT`  | Updates or binds a model alias                                         | `SetModelAliasRequest`, `X-Actor-ID`                   |

---

## 7. Security, Authorization & Service Identity

1. **Zero Provider Secrets**: The Model Registry database and application memory contain zero upstream provider secrets (no Anthropic, OpenAI, or Google keys).
2. **mTLS / Service Mesh Identity**: Inbound connections require mutual TLS (mTLS) with cryptographically verified service identities.
3. **Role-Based Service Authorization (RBAC)**:
   - **`ai-orchestrator`**: Granted `models:read`, `catalog:read`, and `models:resolve` only.
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
   - `ModelResolutionResponse` objects keyed by `${canonicalModelId}:${version}:${tenantId}:${effort}`.
   - Dynamic catalog listings (`GET /internal/v1/catalog`).
   - Canonical model administrative listings (`GET /internal/v1/models`).
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
   - If pricing changes, context window limits expand upstream, or supported effort levels change, a new semantic version (e.g. `v1.1.0`) must be published.
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

- `canonicalModelId`: Must match regex `^[a-z0-9][a-z0-9._-]{1,63}$` (supporting both modern model IDs like `claude-sonnet`, `gpt-4o` and namespaced IDs like `oicunt.model.general`).
- `version`: Must match SemVer format `^v?[0-9]+\.[0-9]+\.[0-9]+$`.
- `effort`: When specified, must be one of `capabilities.supportedEffortLevels` defined on the model version.
- `targetWeights`: Target weights for targets sharing the same priority must sum to a positive integer (typically `100`).
- `limits`: `contextWindowTokens` and `maxOutputTokens` must be strictly positive integers (`> 0`).
- `pricing`: Token rates must be non-negative floats (`>= 0.0`).
- `upstreamModelId`: Cannot be empty or contain whitespace.

### 11.2 Error Code Taxonomy

| Error Code                    | HTTP Status | Trigger Condition                                                   |
| ----------------------------- | :---------: | ------------------------------------------------------------------- |
| `MODEL_NOT_FOUND`             |     404     | Canonical model ID does not exist in catalog                        |
| `VERSION_NOT_FOUND`           |     404     | Requested version or alias does not exist                           |
| `MODEL_DEPRECATED`            |     410     | Model version is permanently retired                                |
| `MODEL_IN_MAINTENANCE`        |     503     | Model version is temporarily offline for maintenance                |
| `NO_ELIGIBLE_TARGETS`         |     503     | No targets are in `available` state for this version                |
| `UNSUPPORTED_EFFORT_LEVEL`    |     400     | Model does not support reasoning effort or requested effort invalid |
| `INVALID_ROUTING_POLICY`      |     400     | Target priorities, weights, or strategy parameters violate rules    |
| `ALIAS_CYCLE_DETECTED`        |     400     | Alias points to another alias forming a circular loop               |
| `IMMUTABLE_VERSION_VIOLATION` |     409     | Attempted mutation of an immutable published version                |

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
