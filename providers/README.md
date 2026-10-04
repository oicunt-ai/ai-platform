# Model Providers Boundary (`providers/`)

This directory defines the boundary for **Upstream AI Model Provider Adapters** in the OICUNT AI Platform.

---

## 1. Architectural Purpose

The `providers/` boundary isolates external AI model vendors (e.g. Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure OpenAI, local inference endpoints) from the rest of the OICUNT platform.

```
┌─────────────────────────────────┐
│     OICUNT Model Gateway        │
└─────────────────────────────────┘
                 │
                 ▼  (Canonical contracts: @oicunt-ai/ai-types, @oicunt-ai/model-types)
┌─────────────────────────────────────────────────────────────────┐
│                       providers/ Boundary                       │
│                                                                 │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────┐ │
│  │ Anthropic     │ │ OpenAI        │ │ Google Gemini │ │ ...  │ │
│  │ Adapter       │ │ Adapter       │ │ Adapter       │ │      │ │
│  └───────────────┘ └───────────────┘ └───────────────┘ └──────┘ │
└─────────────────────────────────────────────────────────────────┘
                 │
                 ▼  (Vendor-specific wire protocols & SDKs)
┌─────────────────────────────────────────────────────────────────┐
│               Upstream External Model APIs                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Boundary Invariants

1. **Zero Vendor Leakage**:
   - Provider SDK types, raw request JSON, and vendor-specific parameter names (`max_tokens_to_sample`, `system_instruction`, `safety_settings`, etc.) must **never** escape the provider adapter.
   - Internal services only consume and produce `@oicunt-ai/ai-types` and `@oicunt-ai/model-types`.

2. **Bidirectional Translation**:
   - Inbound: Translates `NormalizedCompletionRequest` into the vendor's native API format.
   - Outbound: Translates the vendor's native response or SSE stream into `NormalizedCompletionData` or `StreamEvent` SSE chunks.

3. **Authoritative Error Normalization**:
   - Upstream HTTP status codes, provider error codes (e.g. `rate_limit_exceeded`, `context_length_exceeded`, `invalid_api_key`), and network aborts must be mapped into canonical platform error envelopes.
   - Internal credentials and vendor error details must be stripped before bubbling to clients.

4. **Credential Isolation**:
   - Vendor API keys, AWS IAM roles, and secret rotation credentials reside exclusively within provider adapter infrastructure. No other platform component has access to provider tokens.

5. **Resilience & Rate Limiting**:
   - Adapters encapsulate provider-specific retry budgets, jittered exponential backoffs, concurrency limits, and circuit breakers.

---

## 3. Implementation Status

> [!NOTE]
> In accordance with the repository foundation milestones, **no concrete provider adapters or vendor SDKs are implemented yet**.
> Implementation of adapters (`anthropic`, `openai`, `google`, `bedrock`, etc.) will take place in subsequent dedicated milestones following the contracts defined in `@oicunt-ai/model-types` and `@oicunt-ai/ai-types`.
