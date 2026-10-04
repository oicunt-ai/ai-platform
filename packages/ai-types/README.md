# `@oicunt-ai/ai-types`

Universal AI conversation primitives, canonical turn structures, multimodal content blocks, completion requests/responses, and streaming events for the OICUNT AI Platform.

---

## Scope

- Roles: `MessageRole` (`system`, `user`, `assistant`, `tool`)
- Content Parts: `TextPart`, `ImagePart`, `ToolCallPart`, `ToolResultPart`, `ThinkingPart`
- Unified Chat Message: `ChatMessage`
- Completion Contracts: `NormalizedCompletionRequest`, `NormalizedCompletionData`
- Streaming Event Contracts: `StreamEvent`, `StreamEventType`, event payloads

## Boundary Invariants

- Upstream provider-specific payloads (OpenAI JSON, Anthropic JSON, Google Gemini JSON) must NEVER be exposed directly in this package.
- All services (Orchestrator, Model Gateway, etc.) communicate using these normalized primitives.
- Pure contracts with zero runtime dependencies.
