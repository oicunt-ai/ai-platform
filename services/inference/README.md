# OICUNT AI Platform: Inference Service

**Package**: `@oicunt-ai/service-inference`  
**Service Port**: `3004` (Default)  
**Classification**: Stateless Inference-Runtime Coordination Layer  
**Specification**: [`docs/contracts/inference.md`](../../docs/contracts/inference.md)

---

## 1. Architectural Role & Position

The **Inference Service** is the stateless inference-runtime coordination layer in the OICUNT AI Platform, positioned between the **AI Orchestrator** and the **Model Gateway**.

```
Product Application (e.g. BILLY)
  ↓ HTTPS + Bearer JWT
Platform API Gateway (Perimeter Ingress & Auth)
  ↓ POST /internal/v1/orchestrator/chat (Service-to-Service Auth)
AI Orchestrator (Coordination Plane)
  ↓ POST /internal/v1/inference/execute (Service-to-Service Auth)
Inference Service (Runtime Execution Layer)
  ↓ POST /internal/v1/models/dispatch (Service-to-Service Auth)
Model Gateway (Data Plane & Provider Execution)
  ↓ Provider Adapter (Internal Anti-Corruption Layer)
Upstream Providers (upstream provider / OpenAI / Google)
```

### Architectural Boundary Matrix

| Subsystem             | Architectural Role                      | Core Responsibilities                                                                                                                  |
| :-------------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **AI Orchestrator**   | **Application Interaction Coordinator** | High-level chat, prompts, conversation turns, Model Registry resolution, context limits.                                               |
| **Inference Service** | **Runtime Execution Coordinator**       | Normalized inference boundaries, execution lifecycle, TTFT tracking, deadline/cancellation propagation, reasoning privacy enforcement. |
| **Model Gateway**     | **Data-Plane Execution Engine**         | Provider adapters, target selection, retries, jitter backoff, circuit breaking, streaming translation.                                 |

---

## 2. Strict Architectural Invariants

1. **Zero Provider SDKs & Credentials**:
   The Inference Service contains zero third-party provider SDKs (`a vendor SDK`, `openai`, `@google/genai`) and zero provider credentials. Model Gateway remains the sole provider execution boundary.
2. **Provider Detail Containment**:
   Internal execution targets (`targetExecuted`) and provider names (`provider`) are completely excluded from `InferenceExecutionResponse` and `InferenceExecutionMetadata`. They are retained strictly in OpenTelemetry span attributes and internal debug logs.
3. **Gateway Routing Isolation**:
   Inference does not configure Gateway retries, circuit breakers, or target failover. `eligibleTargets` and `routingPolicy` are opaque pass-through resolution metadata.
4. **Monotonic Deadlines**:
   When `Date.now() >= request.deadlineMs`, Inference immediately rejects the request with `InferenceTimeoutError` (HTTP 504) without dispatching to Model Gateway.
5. **Zero Mid-Stream Retry**:
   Once the first SSE event (`token`, `thinking`, `tool_call`) is emitted to the caller, no retry or target failover is permitted. Any subsequent failure emits an error event and terminates the stream.
6. **Reasoning Privacy Enforcement**:
   When `exposeReasoning === false`, thinking content is stripped from unary assistant messages and filtered out from streaming chunks before delivery.
7. **Stateless Lifecycle**:
   Inference owns no database, no session persistence, and no memory.

---

## 3. Endpoints

### Health Probes (Unauthenticated)

- `GET /healthz`: Liveness probe (`200 OK`)
- `GET /readyz`: Readiness probe (`200 OK` / `503 Service Unavailable`, checks Model Gateway connectivity)

### Internal Coordination API (Authenticated)

- `POST /internal/v1/inference/execute`: Main inference execution endpoint supporting unary JSON or SSE streaming.

---

## 4. Configuration & Environment Variables

| Variable                     | Default                                                                         | Description                                                          |
| :--------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------- |
| `PORT`                       | `3004`                                                                          | Service HTTP port                                                    |
| `HOST`                       | `0.0.0.0`                                                                       | Bind host address                                                    |
| `NODE_ENV`                   | `development`                                                                   | Runtime environment (`development`, `staging`, `production`, `test`) |
| `MODEL_GATEWAY_BASE_URL`     | `http://localhost:3002`                                                         | Base URL for Model Gateway data plane                                |
| `INTERNAL_SERVICE_TOKEN`     | _None_                                                                          | Internal Bearer authentication token                                 |
| `ALLOWED_SERVICE_IDENTITIES` | `platform-api-gateway,billy-api,ai-orchestrator,ai-platform-admin,agent-runner` | Whitelisted `X-Service-Name` caller identities                       |
| `DEFAULT_TIMEOUT_MS`         | `60000`                                                                         | Default execution timeout (60s)                                      |
| `MAX_TIMEOUT_MS`             | `300000`                                                                        | Maximum execution timeout cap (300s)                                 |
| `EXPOSE_REASONING_DEFAULT`   | `true`                                                                          | Default privacy policy for reasoning deltas                          |
| `LOG_LEVEL`                  | `info`                                                                          | Logging verbosity (`debug`, `info`, `warn`, `error`, `silent`)       |

---

## 5. Development & Testing

```bash
# Type check
pnpm --filter @oicunt-ai/service-inference type-check

# Run test suite
pnpm test services/inference
```
