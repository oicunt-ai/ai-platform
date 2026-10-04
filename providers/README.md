# Model Providers Boundary (`providers/`)

This directory defines the boundary for **Upstream AI Model Provider Adapters** in the OICUNT AI Platform.

---

## 1. Architectural Purpose & Anti-Corruption Layer

The `providers/` boundary isolates external AI model vendors (e.g. Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure OpenAI, local model runners) from the rest of the OICUNT platform.

```
┌─────────────────────────────────────────────────────────────────┐
│                     OICUNT Model Gateway                        │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼ (Canonical contracts: @oicunt-ai/ai-types, @oicunt-ai/model-types)
┌─────────────────────────────────────────────────────────────────┐
│                      providers/ Boundary                        │
│                                                                 │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────┐ │
│  │ Anthropic     │ │ OpenAI        │ │ Google Gemini │ │ ...  │ │
│  │ Adapter       │ │ Adapter       │ │ Adapter       │ │      │ │
│  └───────────────┘ └───────────────┘ └───────────────┘ └──────┘ │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼ (Vendor-specific wire protocols & SDKs)
┌─────────────────────────────────────────────────────────────────┐
│                  Upstream External Model APIs                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Boundary Invariants

1. **Zero Vendor Leakage**:
   - Provider SDK types, raw request JSON, and vendor-specific parameter names (`max_tokens_to_sample`, `system_instruction`, `safety_settings`, etc.) must **never** escape the provider adapter.
   - All internal platform components only consume and produce `@oicunt-ai/ai-types` and `@oicunt-ai/model-types`.

2. **Model/Provider Separation**:
   - Platform services reference models exclusively via canonical OICUNT identifiers (`oicunt.model.general`, `oicunt.model.reasoning`).
   - Provider-specific model IDs (e.g. `claude-3-5-sonnet-20241022`, `gpt-4o-2024-08-06`) remain internal to provider configuration and are resolved exclusively within the Model Gateway and provider adapter.

3. **Bidirectional Translation Mechanics**:
   - **Inbound Translation**: Converts `NormalizedCompletionRequest` into the vendor's native API request payload.
   - **Outbound Translation**: Converts synchronous vendor responses into `NormalizedCompletionData`.
   - **Streaming Translation**: Parses raw vendor chunk events and emits canonical `StreamEvent` SSE events (`token`, `tool_call`, `thinking`, `finish`, `error`).

4. **Authoritative Error Normalization**:
   - Upstream HTTP status codes, provider error codes (`rate_limit_exceeded`, `context_length_exceeded`, `authentication_error`), and network aborts must be mapped into canonical platform error envelopes.
   - Internal credentials and vendor error details must be stripped before bubbling to callers.

5. **Credential Containment**:
   - Vendor API keys, AWS IAM roles, and secret rotation credentials reside exclusively within provider adapter infrastructure. No other platform component has access to provider tokens.

6. **Resilience & Rate Limiting**:
   - Adapters encapsulate provider-specific retry budgets, jittered exponential backoffs, concurrency limits, and circuit breakers to insulate the platform against upstream outages.

---

## 3. Future Adapter Specifications

When implemented in subsequent milestones, adapters will include:

- `providers/anthropic`: Anthropic Messages API client and Claude SSE stream normalizer.
- `providers/openai`: OpenAI Chat Completions client and chunk normalizer.
- `providers/google`: Google GenAI SDK adapter and Gemini stream normalizer.
- `providers/bedrock`: AWS Bedrock Converse API adapter with SigV4 request signing.
- `providers/local`: Self-hosted model endpoint adapter (vLLM / Ollama).
