# Provider Adapter Boundary

This directory documents the provider anti-corruption boundary used by the Model Gateway.

One concrete provider adapter is currently included: **Groq** (`services/model-gateway/src/infrastructure/adapters/groq/`), speaking Groq's OpenAI-compatible Chat Completions API. It is registered with the Model Gateway adapter registry only when `GROQ_API_KEY` is configured; without it the gateway honestly reports not-ready and dispatch returns the existing provider-unavailable error. Future providers must be implemented behind the existing `IProviderAdapter` contract and registered the same way. Adding an adapter must not add provider logic to BILLY, Platform Gateway, AI Orchestrator, Inference, or Model Registry.

Local configuration: export `GROQ_API_KEY` in the Model Gateway process environment (the repository has no `.env` loader — a root `.env` file is not read automatically). Optional `GROQ_BASE_URL` override (default `https://api.groq.com/openai/v1`).

The boundary guarantees:

- public callers select only stable IDs in the `oicunt.model.<catalog-slug>` namespace;
- Model Registry stores the private mapping from an OICUNT model ID to provider targets and upstream model IDs;
- Model Gateway selects the registered adapter named by the resolved target;
- provider credentials and endpoints belong to the adapter's Model Gateway configuration, never Registry metadata;
- raw provider requests, responses, errors, and model identifiers never cross the adapter boundary;
- normalized streaming, cancellation, timeout, retry, error, and Usage behavior remains owned by the existing Model Gateway pipeline.

Until a provider adapter is configured, Model Gateway remains live but reports not-ready and dispatch returns the existing provider-unavailable error.

## Groq initial model

Public OICUNT model ID `oicunt.model.groq-gpt-oss-20b` maps internally to provider `groq`, upstream model `openai/gpt-oss-20b`. Registration uses the existing Registry admin API (actor-gated; no code seeds, no hardcoded aliases):

1. `POST /internal/v1/models` with `{ id: "oicunt.model.groq-gpt-oss-20b", displayName, description, family: "groq-gpt-oss", activeVersion: "v1.0.0" }`.
2. `POST /internal/v1/models/oicunt.model.groq-gpt-oss-20b/versions` with `{ version: "v1.0.0", modalities: ["text"], capabilities: { streaming, toolCalling, structuredOutputs, reasoning, vision, audioInput, audioOutput, systemInstructions, supportedEffortLevels, defaultEffortLevel }, limits: { contextWindowTokens, maxOutputTokens }, pricing, status: "available" }`.
3. `POST /internal/v1/models/oicunt.model.groq-gpt-oss-20b/targets` with `{ id, modelVersionId, provider: "groq", upstreamModelId: "openai/gpt-oss-20b", supportsStreaming: true, status: "available" }`. Never put credentials in `adapterOptions` — Registry validation rejects secret-like keys.
4. Optionally `PUT .../routing-policy` for failover strategy.

The entry becomes selectable only when the version is available/degraded **and** at least one eligible target exists; execution additionally requires the Groq adapter registered (see above), otherwise dispatch honestly reports provider-unavailable. Public catalog entries never expose the upstream model ID, endpoints, or credentials.

## Groq runtime behavior

- Unary and streaming go through `IProviderAdapter`; usage maps prompt/completion/total tokens plus `reasoningTokens`/`cachedTokens` when reported (never fabricated — absent stream usage yields zeros per existing conventions).
- Provider `reasoning` content becomes internal `thinking` parts/events; the gateway strips them unless `exposeReasoning === true`, so public responses never leak reasoning by default.
- Errors map to normalized gateway codes (401/403 → configuration error, 429 → retryable rate limit, 5xx/transport → retryable unavailable, 400 → context/policy/invalid); cancellation aborts propagate as `REQUEST_CANCELLED` without retries.
