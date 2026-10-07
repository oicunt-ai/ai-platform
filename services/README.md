# AI Platform Services (`services/`)

This directory is reserved for autonomous AI microservices owned by the **OICUNT AI Platform**.

---

## 1. Architectural Role & Boundary

Services within this repository own **AI-specific capabilities and infrastructure**.

### Critical Platform Boundary Invariants

- **Independent from Company Platform Repository**: The OICUNT company maintains a dedicated platform repository (`https://github.com/oicunt-ai/platform`) which authoritatively owns company-wide capabilities:
  - User authentication and identity provider integration (AuthN)
  - Public API Gateway and ingress routing
  - Organization and tenant management
  - Billing, subscriptions, products, and usage tracking
  - Canonical operational databases, message brokers, and enterprise events
  - _Note: BILLY is the separate OICUNT AI Assistant product repository that consumes platform and ai-platform capabilities._
- **No Duplication**: The AI Platform must **never** duplicate company-wide services, authentication servers, billing engines, or external client gateways.
- **Trusted Upstream Context**: AI services operate behind the platform perimeter. Inbound requests to AI services have already been authenticated by the company platform gateway. Identity headers (`X-User-ID`, `X-Tenant-ID`, `X-Correlation-ID`) are trusted authoritative metadata injected by the platform gateway.
- **Database-Per-Service Rule**: Services must own their persistent data. Services never share a database or persistent datastore.
- **Canonical Model Identifiers**: Services communicate using canonical OICUNT model IDs (`oicunt.model.*`) from `@oicunt-ai/model-types`. Raw upstream vendor model names (`gpt-4o`, `claude-3-5-sonnet`) are strictly prohibited in service logic.
- **Zero Provider SDK Leaks**: Provider SDKs (OpenAI, Anthropic, Google) are strictly confined to `providers/`. Services never import upstream vendor SDKs.

---

## 2. Canonical Hexagonal Architecture

All AI services strictly enforce Clean / Hexagonal Architecture (Ports and Adapters):

```
interfaces (Inbound Adapters: HTTP routes, controllers, middleware, health probes)
    ↓
application (Use Cases, Interactors, Port Interfaces, Input/Output DTOs)
    ↓
domain (Entities, Value Objects, Domain Errors, Invariants)
    ↓
infrastructure (Outbound Adapters: Persistence, Downstream Clients, Config)
```

A reusable service template demonstrating this pattern is provided in `templates/service` (`@oicunt-ai/service-template`).

---

## 3. Planned AI Services Landscape

The following 10 services are designated for future implementation milestones:

```
services/
├── orchestrator/       # Turn-by-turn workflow engine, multi-agent coordination, and tool loops
├── model-gateway/      # Outbound provider dispatch, resilience, fallback routing, and stream normalization
├── model-registry/     # Canonical model catalog, model routing rules, cost tables, and capability metadata
├── inference/          # Low-latency model execution routing, batch scheduling, and priority queuing
├── memory/             # Working memory, conversational history, and episodic context stores (see docs/contracts/memory.md)
├── knowledge/          # Knowledge spaces/collections, document processing, chunking, and similarity retrieval (see docs/contracts/knowledge.md)
├── embeddings/         # High-throughput vector embedding generation endpoint (see docs/contracts/embeddings.md)
├── tools/              # Centralized tool execution engine, sandboxing, and permission checks (see docs/contracts/tools.md)
├── agents/             # Autonomous agent state machine, persistent run loops, and task step execution (see docs/contracts/agents.md)
└── mcp/                # Model Context Protocol bridge and server connectors (see docs/contracts/mcp.md)
```

### Detailed Service Specifications

| Service          | Responsibility                                                                                                                                                                                                                    | Inbound Ports (Interfaces)                                             | Outbound Ports (Dependencies)                                                    | Invariants                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator`   | Coordinates conversational turns, prompt assembly, and iterative tool loops (see [AI Orchestrator Contract](../docs/contracts/ai-orchestrator.md)).                                                                               | HTTP turn endpoint (`/internal/v1/orchestrator/chat`), Event listeners | Inference, Model Registry, Memory, Knowledge, Tools                              | Must contain zero provider-specific code or SDKs. Operates purely on canonical models.                                                                                                 |
| `model-gateway`  | The singular provider egress boundary. Normalizes payloads, manages provider fallbacks, enforces rate limits, handles SSE streams (see [Model Gateway Contract](../docs/contracts/model-gateway.md)).                             | HTTP dispatch endpoint (`/internal/v1/models/dispatch`)                | Provider Adapters (`providers/*`), Observability                                 | The only component authorized to invoke provider adapters. Emits normalized `StreamEvent` SSE events.                                                                                  |
| `model-registry` | Canonical model catalog. Resolves `oicunt.model.*` identifiers into provider targets, limits, and cost tables (see [Model Registry Contract](../docs/contracts/model-registry.md)).                                               | HTTP query endpoint (`/internal/v1/models/:modelId`)                   | Registry Database / Config store                                                 | Authoritative source for canonical model capabilities, pricing, and context window limits.                                                                                             |
| `inference`      | Coordinates inference execution lifecycle, normalized request/response boundaries, deadline/cancellation, and streaming (see [Inference Service Contract](../docs/contracts/inference.md)).                                       | HTTP inference endpoint (`/internal/v1/inference/execute`)             | Model Gateway, Observability, Internal runtimes                                  | Must call Model Gateway (never providers directly). Enforces zero mid-stream retry and monotonic deadlines.                                                                            |
| `memory`         | Manages conversation memory windows, message persistence, token summarization, and episodic context stores (see [Memory Service Contract](../docs/contracts/memory.md)).                                                          | HTTP memory query & update (`/internal/v1/memory/*`)                   | Dedicated memory storage adapter (PostgreSQL)                                    | Isolates memory retrieval and updates per tenant and user. Enforces strictly increasing, unique sequence numbers. Never calls providers or executes inference.                         |
| `knowledge`      | Owns user/tenant collections, document lifecycle, chunking, abstract embeddings, vector similarity search, and provenance (see [Knowledge Service Contract](../docs/contracts/knowledge.md)).                                     | HTTP API (`/internal/v1/knowledge/*`), async document job worker       | DocumentRepositoryPort, VectorStorePort, EmbeddingServicePort, ObjectStoragePort | Tenant-isolated. Never calls model providers directly or executes LLM inference. Immediate exclusion on logical document deletion. Document processing is asynchronous and idempotent. |
| `embeddings`     | Authoritative provider-neutral vector embedding generation layer. Enforces batch atomicity, dimension validation, and dispatches egress via Model Gateway (see [Embeddings Service Contract](../docs/contracts/embeddings.md)).   | HTTP embedding API (`/internal/v1/embeddings/embed`)                   | Model Registry, Model Gateway                                                    | Provider-neutral. Never holds provider credentials or calls providers directly. Enforces strict input-to-vector ordering and batch atomicity. Never logs raw text or vector floats.    |
| `tools`          | Canonical tool catalog, execution engine, sandboxing, permission checks, and capability governance (see [Tools Service Contract](../docs/contracts/tools.md)).                                                                    | HTTP discovery, execution, & registration (`/internal/v1/tools/*`)     | Sandboxed runtimes, OICUNT services, external APIs, MCP bridge                   | Executes tool calls in isolated sandboxes with strict execution timeouts, SSRF firewalls, and pre-execution schema validation.                                                         |
| `mcp`            | Model Context Protocol gateway and bridge connecting external tool, resource, and prompt servers into the AI platform, and exposing approved OICUNT tools to external MCP clients (see [MCP Contract](../docs/contracts/mcp.md)). | Streamable HTTP / stdio / legacy SSE                                   | Tools Service (`services/tools`)                                                 | Protocol-only boundary. Bridges MCP protocol framing to internal Tools Service interfaces. Never executes tools directly; never bypasses Tool security or authorization.               |

---

## 4. Implementation Guidelines (For Future Milestones)

When implementing services in future phases:

1. **Scaffold from Template**: Copy and configure `templates/service`.
2. **Implement Health Probes**: Maintain `/healthz` (liveness) and `/readyz` (readiness).
3. **Propagate Context**: Extract and forward `X-Correlation-ID`, `X-User-ID`, and `X-Tenant-ID`.
4. **Use Shared Contracts**: Consume contracts from `packages/*` (`@oicunt-ai/model-types`, `@oicunt-ai/ai-types`, etc.).
5. **No Provider Leaks**: Never import provider SDKs in any service. All provider communication routes through `model-gateway`.
