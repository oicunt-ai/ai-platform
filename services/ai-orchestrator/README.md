# OICUNT AI Platform: AI Orchestrator Service

**Package**: `@oicunt-ai/service-ai-orchestrator`  
**Service Port**: `3003` (Default)  
**Classification**: Application-Level AI Interaction Coordinator  
**Specification**: [`docs/contracts/ai-orchestrator.md`](../../docs/contracts/ai-orchestrator.md)

---

## 1. Architectural Role & Position

The **AI Orchestrator** is the unified, application-level execution coordinator between product applications (such as **BILLY**) and the **OICUNT AI Platform**.

```
BILLY (Product Application)
  ↓ POST /internal/v1/orchestrator/chat
AI Orchestrator (Coordination Plane)
  ├── 1. GET /internal/v1/models/resolve/:id (Model Registry - Control Plane)
  └── 2. POST /internal/v1/models/dispatch (Model Gateway - Data Plane)
          ↓
     Provider Adapter (Anti-Corruption Layer)
          ↓
     Upstream Provider (Anthropic / OpenAI / Google)
```

### Tripartite Architecture Boundary

| Subsystem           | Architectural Role                      | Core Question Owned                                                                                 |
| :------------------ | :-------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| **AI Orchestrator** | **Application Interaction Coordinator** | **WHAT interaction should happen?** Prompt harmonization, streaming delivery, deadline budgeting.   |
| **Model Registry**  | **Control-Plane Catalog & Resolution**  | **WHAT models and targets exist?** Capabilities, limits, pricing, eligible targets.                 |
| **Model Gateway**   | **Data-Plane Execution Engine**         | **HOW is the model executed?** Sockets, retries, jitter backoff, circuit breaking, target failover. |

---

## 2. Strict Architectural Invariants

1. **Zero Provider SDKs & Credentials**:
   The Orchestrator contains zero third-party provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`), zero vendor tokenizers (`tiktoken`), and zero provider API keys or credentials.
2. **Canonical Model Identity Preservation**:
   The user-selected canonical model (`claude-sonnet`, `gpt-4o`, `gemini-pro`, etc.) is strictly preserved and never substituted. Target-level redundancy is handled within the Model Gateway for that exact model identity.
3. **Reasoning Effort Governance**:
   Reasoning effort (`low` | `medium` | `high`) is validated against model capabilities resolved from the Model Registry.
4. **Bounded Preflight Context Window Estimation**:
   Context bounds are estimated using provider-neutral heuristics (~4 characters/token) against limits supplied by Model Registry. Oversized requests are rejected early (`CONTEXT_WINDOW_EXCEEDED`, HTTP 400). Actual execution authority remains with the Model Gateway.
5. **Zero Mid-Stream Retry**:
   Once the first chunk (`token`, `thinking`, `tool_call`) is streamed to the caller, no retry or target fallback is permitted.
6. **Cancellation Propagation**:
   Inbound client disconnects (`req.on('close')`) trigger an `AbortSignal` propagated downstream to Model Gateway to terminate provider execution immediately.
7. **Usage Accounting Boundary**:
   The Orchestrator propagates execution token usage received from Model Gateway. It does **not** own durable billing aggregation or usage persistence (reserved for the Platform Usage service).

---

## 3. Endpoints

### Health Probes (Unauthenticated)

- `GET /health/liveness` (or `/healthz`): Liveness probe (`200 OK`)
- `GET /health/readiness` (or `/readyz`): Readiness probe (`200 OK` / `503 Service Unavailable`)

### Internal Coordination API (Authenticated)

- `POST /internal/v1/orchestrator/chat`: Main execution entrypoint for unary JSON or SSE streaming completions.

---

## 4. Configuration & Environment Variables

| Variable                     | Default                                                         | Description                                                          |
| :--------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------- |
| `PORT`                       | `3003`                                                          | Service HTTP port                                                    |
| `HOST`                       | `0.0.0.0`                                                       | Bind host address                                                    |
| `NODE_ENV`                   | `development`                                                   | Runtime environment (`development`, `staging`, `production`, `test`) |
| `MODEL_REGISTRY_BASE_URL`    | `http://localhost:3001`                                         | Base URL for Model Registry control plane                            |
| `MODEL_GATEWAY_BASE_URL`     | `http://localhost:3002`                                         | Base URL for Model Gateway data plane                                |
| `INTERNAL_SERVICE_TOKEN`     | _None_                                                          | Internal Bearer authentication token                                 |
| `ALLOWED_SERVICE_IDENTITIES` | `platform-api-gateway,billy-api,ai-platform-admin,agent-runner` | Whitelisted `X-Service-Name` caller identities                       |
| `DEFAULT_TIMEOUT_MS`         | `120000`                                                        | Default turn execution timeout (120s)                                |
| `MAX_TIMEOUT_MS`             | `300000`                                                        | Maximum turn execution timeout cap (300s)                            |
| `CACHE_TTL_SECONDS`          | `45`                                                            | L1 resolution cache TTL in seconds                                   |
| `EXPOSE_REASONING_DEFAULT`   | `true`                                                          | Default privacy policy for reasoning deltas                          |
| `LOG_LEVEL`                  | `info`                                                          | Logging verbosity (`debug`, `info`, `warn`, `error`, `silent`)       |

---

## 5. Development & Testing

```bash
# Type check
pnpm --filter @oicunt-ai/service-ai-orchestrator type-check

# Run test suite
pnpm test services/ai-orchestrator
```
