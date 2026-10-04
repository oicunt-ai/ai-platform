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
  - Note: BILLY is the separate OICUNT AI Assistant product repository that consumes platform and ai-platform capabilities.
- **No Duplication**: The AI Platform must **never** duplicate company-wide services, authentication servers, or external client gateways.
- **Trusted Upstream Context**: AI services operate behind the platform perimeter. Inbound requests to AI services have already been authenticated by the company platform gateway. Identity headers (`X-User-ID`, `X-Tenant-ID`) are trusted authoritative metadata injected by the platform gateway.

---

## 2. Planned AI Services Landscape

The following services are designated for future milestones. **They are intentionally NOT implemented at this stage**:

```
services/
├── orchestrator/       # Turn-by-turn workflow engine, multi-agent coordination, and tool loops
├── model-gateway/      # Outbound provider dispatch, resilience, fallback routing, and stream normalization
├── model-registry/     # Canonical model catalog, model routing rules, cost tables, and capability metadata
├── inference/          # Low-latency model execution routing, batch scheduling, and priority queuing
├── memory/             # Working memory, conversational history, and episodic context stores
├── knowledge/          # Vector indexing coordination, semantic search orchestration, and knowledge retrieval
├── embeddings/         # High-throughput vector embedding generation service
├── tools/              # Centralized tool execution engine, sandboxing, and permission checks
├── agents/             # Autonomous agent state machine, persistent run loops, and task step execution
└── mcp/                # Model Context Protocol bridge and server connectors
```

### Planned Service Summary

| Service          | Responsibility                                                                                                              | Upstream / Downstream Interaction                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `orchestrator`   | Coordinates conversational turns, determines when to invoke tools, models, or agents.                                       | Receives requests from Platform API Gateway; invokes Model Gateway and Tool runtime. |
| `model-gateway`  | Normalizes prompt payloads, dispatches to upstream providers via `providers/`, and maps responses to `@oicunt-ai/ai-types`. | Receives requests from Orchestrator; communicates with upstream LLM providers.       |
| `model-registry` | Maintains catalog of canonical model IDs (`oicunt.model.*`) and their provider targets, pricing, and limits.                | Queried by Orchestrator and Model Gateway.                                           |
| `inference`      | Routes and manages dedicated inference jobs and local/self-hosted model instances.                                          | Sits downstream of Model Gateway or standalone queue workers.                        |
| `memory`         | Manages conversation memory windows, summaries, and agent episodic memory.                                                  | Queried and updated by Orchestrator and Agents.                                      |
| `knowledge`      | Orchestrates search across enterprise indices and documents for retrieval augmentation.                                     | Queried by Orchestrator during RAG turns; feeds from `workers/document-processing`.  |
| `embeddings`     | Synchronous embedding generation endpoint for search and classification.                                                    | Used by Knowledge service and ingestion pipelines.                                   |
| `tools`          | Sandboxed execution environment for deterministic and custom tools.                                                         | Invoked by Orchestrator or Agents upon model tool call requests.                     |
| `agents`         | Long-running autonomous agent lifecycle manager and state persistence.                                                      | Manages background tasks triggered by Platform or user workflows.                    |
| `mcp`            | Model Context Protocol gateway allowing pluggable tool and resource servers.                                                | Integrates MCP clients with internal AI Platform tool runtime.                       |

---

## 3. Service Implementation Guidelines (For Future Milestones)

When implementing services in future phases:

1. **Hexagonal Architecture (Ports and Adapters)**:
   - Each service maintains strict separation: `domain/` (pure business logic), `application/` (use cases, ports), `infrastructure/` (adapters, persistence, clients), `interfaces/` (HTTP/gRPC endpoints).
2. **Database-Per-Service Rule**:
   - Services must never share a database or persistent datastore.
3. **Canonical Type Adoption**:
   - Services must consume contracts from `packages/*` (`@oicunt-ai/model-types`, `@oicunt-ai/ai-types`, etc.) rather than defining bespoke representations.
4. **Structured Observability**:
   - All services must trace spans with `@oicunt-ai/observability` and propagate `X-Correlation-ID`.
