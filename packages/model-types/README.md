# `@oicunt-ai/model-types`

Foundational model domain types, capabilities, token usage metrics, and canonical model catalog specifications for the OICUNT AI Platform.

---

## Scope

- Canonical model identifiers (`CanonicalModelId`)
- Model providers (`ModelProviderType`)
- Model modalities and capability flags (`ModelCapabilities`)
- Token usage accounting (`TokenUsage`)
- Model invocation parameters (`ModelInvocationParameters`)
- Catalog specifications and limits (`ModelSpec`, `ModelLimits`, `ModelPricing`)

## Boundary Invariants

- No vendor-specific SDK imports.
- Pure contracts with zero runtime dependencies.
- All model routing across OICUNT services uses canonical model IDs defined herein.
