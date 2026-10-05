# OICUNT Model Gateway Service

`@oicunt-ai/service-model-gateway` is the singular, authoritative data-plane execution boundary for all AI model inference across the **OICUNT AI Platform**.

## Architectural Role

```
BILLY (Client)
      ↓
AI Orchestrator
      ↓
Model Registry (WHAT)
      ↓
Model Gateway (HOW)
      ↓
Provider Adapter
      ↓
Upstream Provider (Anthropic, Bedrock, OpenAI, Gemini)
```

The Model Gateway encapsulates:

- Single upstream network egress boundary
- Circuit breaker per provider target
- Unified request execution deadline and retry/fallback budgets
- Request cancellation via `AbortSignal`
- Streaming event normalisation (`@oicunt-ai/ai-types`)
- Reasoning / thinking privacy boundary
- Provider error normalisation into canonical platform codes
- Zero persistent relational database (stateless runtime)

See the authoritative [Model Gateway Architecture Contract](../../docs/contracts/model-gateway.md).
