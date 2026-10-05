# OICUNT AI Platform: Model Registry Service (`services/model-registry`)

The **Model Registry** is the singular control-plane directory and authoritative metadata catalog for all AI models, capability configurations, context limits, pricing tables, and execution target bindings in the **OICUNT AI Platform**.

It provides deterministic resolution of public **Canonical Model Identifiers** (`oicunt.model.*`) into concrete, eligible execution targets and routing policies consumed by the **AI Orchestrator** and executed by the **Model Gateway**.

---

## 1. Architectural Role & Boundary Invariants

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI Orchestrator / BILLY                         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   │ 1. GET /internal/v1/models/resolve/:id
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
│            Anthropic • OpenAI • Google Gemini • AWS Bedrock            │
└────────────────────────────────────────────────────────────────────────┘
```

### Strict Architectural Invariants

1. **Separation of What vs. How**:
   - The **Model Registry** decides **WHAT** model targets are eligible.
   - The **Model Gateway** decides **HOW** execution happens against eligible targets.
2. **Zero Provider SDKs & Credentials**:
   - The Model Registry **never** imports vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`).
   - The Model Registry **never** stores or reads provider API keys or credentials (credentials reside strictly within Model Gateway provider adapters).
   - The Model Registry **never** initiates outbound network calls to external LLM providers.
3. **Internal Upstream Identifiers**:
   - Upstream vendor model names (e.g. `claude-3-5-sonnet-20241022`, `gpt-4o-2024-08-06`) are strictly internal target data and are never exposed to public or client-facing applications.
4. **Canonical Model IDs as Public Abstraction**:
   - Public and service-to-service interfaces only surface canonical identifiers (`oicunt.model.general`, `oicunt.model.reasoning`, `oicunt.model.coding`, etc.).
5. **Exclusive Database Ownership**:
   - The Model Registry owns its dedicated PostgreSQL database schema (`model_registry`). No shared databases or tables with Model Gateway or other services.
6. **Published Version Immutability**:
   - Published, active model versions enforce strict immutability of capabilities, limits, pricing, and modalities.
7. **Deterministic Resolution**:
   - For identical effective configuration state and tenant context, resolution always produces identical target ordering.
   - Unavailable (`maintenance` or `deprecated`) targets are **never** silently returned in eligible target lists.
8. **Append-Only Auditing**:
   - Every administrative mutation writes an immutable record to `model_registry.audit_events`.

---

## 2. Service Architecture (Clean / Hexagonal)

The service follows the layered Hexagonal (Ports and Adapters) pattern:

```
src/
├── domain/                  # Pure Domain Model & Aggregates (Framework-independent)
│   ├── canonical-model.ts   # CanonicalModel Aggregate Root
│   ├── model-version.ts     # ModelVersion Entity (immutability enforcement)
│   ├── model-target.ts      # ModelTarget Entity (priority, weight, cordoning)
│   ├── routing-policy.ts    # RoutingPolicy Entity / Value Object
│   ├── model-alias.ts       # ModelAlias Entity & cycle validation
│   ├── audit-event.ts       # AuditEvent Entity & tamper-evident record
│   ├── errors.ts            # Canonical domain error taxonomy
│   └── types.ts             # Domain types, statuses, and interfaces
│
├── application/             # Application Use Cases & Ports
│   ├── ports/               # Driven Ports (Repository, Audit, Cache)
│   │   ├── model-repository.port.ts
│   │   ├── audit-repository.port.ts
│   │   └── model-cache.port.ts
│   ├── dtos/                # Data Transfer Objects
│   │   ├── resolution.dto.ts
│   │   └── catalog.dto.ts
│   └── use-cases/           # Application Use Cases
│       ├── resolve-model.use-case.ts
│       ├── get-model.use-case.ts
│       ├── list-models.use-case.ts
│       ├── create-canonical-model.use-case.ts
│       ├── create-model-version.use-case.ts
│       ├── update-model-version-status.use-case.ts
│       ├── create-model-target.use-case.ts
│       ├── update-model-target-status.use-case.ts
│       ├── update-routing-policy.use-case.ts
│       └── set-model-alias.use-case.ts
│
├── infrastructure/          # Outbound Adapters & Drivers
│   ├── database/            # PostgreSQL connection pool & migrator
│   │   ├── connection.ts    # DatabasePool (pg.Pool wrapper)
│   │   ├── migrator.ts      # DatabaseMigrator & schema runner
│   │   └── migrations/      # 001_initial_schema.sql
│   ├── repositories/        # Repository implementations
│   │   ├── postgres-model.repository.ts
│   │   ├── postgres-audit.repository.ts
│   │   ├── in-memory-model.repository.ts
│   │   └── in-memory-audit.repository.ts
│   └── cache/               # Caching adapters
│       ├── in-memory-model-cache.ts
│       └── noop-model-cache.ts
│
└── interfaces/              # Inbound Adapters (HTTP)
    └── http/
        ├── context.ts       # RequestContext & header parsing
        ├── middleware.ts    # Standard error handler & response serialization
        ├── health.ts        # /healthz and /readyz probes
        ├── router.ts        # Request dispatcher
        └── controllers/     # Route controllers
            ├── resolution.controller.ts
            └── catalog.controller.ts
```

---

## 3. The 7-Step Model Resolution Pipeline

`GET /internal/v1/models/resolve/:canonicalModelId` executes this deterministic 7-step pipeline:

1. **Request Validation**: Verifies pattern `^oicunt\.model\.[a-z0-9\-]+$` and extracts distributed trace header `X-Correlation-ID`.
2. **Canonical Model Lookup**: Queries `canonical_models`. If missing, terminates with `404 MODEL_NOT_FOUND`.
3. **Version & Alias Resolution**:
   - Resolves explicit version (`?version=v1.2.0`), tenant-specific alias override, global alias (`latest`), or defaults to `active_version`.
   - Circular alias detection terminates with `400 ALIAS_CYCLE_DETECTED`.
4. **Availability State Validation**:
   - If version status is `maintenance`, terminates with `503 MODEL_IN_MAINTENANCE`.
   - If version status is `deprecated`, terminates with `410 MODEL_DEPRECATED`.
5. **Eligible Target Filtering & Deterministic Ordering**:
   - Filters targets linked to the resolved version where `status = 'available'` (or `'degraded'` if allowed by policy).
   - Targets marked `maintenance` or `deprecated` are **strictly excluded**.
   - If 0 eligible targets remain, terminates with `503 NO_ELIGIBLE_TARGETS`.
   - Sorts deterministically: `priority` ASC (1 before 2), `weight` DESC (100 before 50), and `targetId` ASC.
6. **Policy & Pricing Attachment**: Attaches `RoutingPolicyConfig`, `ModelLimits`, and `ModelPricing` to the response.
7. **Delivery & Cache**: Stores resolution response in L1/L2 cache and returns `ModelResolutionResponse`.

---

## 4. API Endpoints

All endpoints are internal, authenticated service endpoints.

### Query Endpoints

| Method | Path                                            | Description                                                  |
| ------ | ----------------------------------------------- | ------------------------------------------------------------ |
| `GET`  | `/healthz`                                      | Liveness probe (`200 OK alive`)                              |
| `GET`  | `/readyz`                                       | Readiness probe (`200 OK ready` / `503` if DB unreachable)   |
| `GET`  | `/internal/v1/models/resolve/:canonicalModelId` | Deterministic model resolution for Orchestrator & Gateway    |
| `GET`  | `/internal/v1/models`                           | List all canonical models (summaries)                        |
| `GET`  | `/internal/v1/models/:canonicalModelId`         | Detailed view of model, versions, targets, policies, aliases |

### Administrative Control-Plane Endpoints (Mutations)

All mutation endpoints mandate `X-Actor-ID` and optional `X-Change-Reason`.

| Method | Path                                           | Description                                                                  |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST` | `/internal/v1/models`                          | Register a new canonical model                                               |
| `POST` | `/internal/v1/models/:id/versions`             | Publish a new semantic model version                                         |
| `PUT`  | `/internal/v1/models/:id/versions/:ver/status` | Update version status (`available`, `degraded`, `maintenance`, `deprecated`) |
| `POST` | `/internal/v1/models/:id/targets`              | Bind an execution target to a version                                        |
| `PUT`  | `/internal/v1/models/:id/targets/:tid/status`  | Target cordoning (`available`, `maintenance`, etc.)                          |
| `PUT`  | `/internal/v1/models/:id/routing-policy`       | Configure failover and routing strategy                                      |
| `PUT`  | `/internal/v1/models/:id/aliases`              | Bind or update model alias                                                   |

---

## 5. PostgreSQL Schema & Migrations

The service requires a dedicated PostgreSQL database with exclusive ownership of schema `model_registry`:

- `canonical_models`: Master catalog, active version pointers, and optimistic locking (`version_lock`).
- `model_versions`: Semantic versions, capabilities, limits, pricing, and immutability lock.
- `model_targets`: Upstream target bindings, priorities, weights, and cordoning status.
- `routing_policies`: Failover strategies, max attempt budgets, and degradation rules.
- `model_aliases`: Global and tenant-specific alias mappings.
- `audit_events`: Tamper-evident append-only ledger for all mutations.

### Running Migrations

Migrations execute automatically via `DatabaseMigrator.runMigrations()` during service startup, or programmatically in CI/deployment pipelines.

---

## 6. Configuration & Environment Variables

| Variable                     | Type    | Default                                           | Description                                                  |
| ---------------------------- | ------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `PORT`                       | number  | `3001`                                            | HTTP server listening port                                   |
| `HOST`                       | string  | `0.0.0.0`                                         | HTTP server binding host                                     |
| `NODE_ENV`                   | string  | `development`                                     | Environment (`development`, `staging`, `production`, `test`) |
| `SHUTDOWN_TIMEOUT_MS`        | number  | `5000`                                            | Graceful shutdown deadline                                   |
| `DATABASE_HOST`              | string  | `localhost`                                       | PostgreSQL host                                              |
| `DATABASE_PORT`              | number  | `5432`                                            | PostgreSQL port                                              |
| `DATABASE_NAME`              | string  | `oicunt_ai`                                       | PostgreSQL database name                                     |
| `DATABASE_USER`              | string  | `postgres`                                        | PostgreSQL username                                          |
| `DATABASE_PASSWORD`          | string  | `""`                                              | PostgreSQL password                                          |
| `DATABASE_SSL`               | boolean | `false`                                           | Enable TLS for PostgreSQL                                    |
| `DATABASE_POOL_MAX`          | number  | `20`                                              | Max connection pool size                                     |
| `CACHE_ENABLED`              | boolean | `true`                                            | Enable resolution cache                                      |
| `CACHE_DEFAULT_TTL_SECONDS`  | number  | `60`                                              | Default resolution cache TTL                                 |
| `CACHE_STALE_TTL_SECONDS`    | number  | `300`                                             | Stale-while-revalidate tolerance                             |
| `ALLOWED_SERVICE_IDENTITIES` | string  | `ai-orchestrator,model-gateway,ai-platform-admin` | Permitted callers                                            |

---

## 7. Local Development & Testing

```bash
# Install dependencies
pnpm install

# Run test suite
pnpm test

# Run type check
pnpm type-check

# Build service
pnpm --filter @oicunt-ai/service-model-registry build
```
