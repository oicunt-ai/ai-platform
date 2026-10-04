# `@oicunt-ai/observability`

AI-specific telemetry contracts, OpenTelemetry GenAI semantic conventions, token metrics recording, latency tracking, and non-blocking tracer doubles for the OICUNT AI Platform.

---

## Scope

- OpenTelemetry GenAI semantic conventions: `GenAiSpanAttributes`
- Trace abstractions: `AiSpan`, `AiTracer`, `AiSpanContext`
- Metrics recorder: `AiMetricsRecorder` (token tracking, cost, request durations, tool calls)
- In-memory test doubles and safe defaults: `NoopAiSpan`, `NoopAiTracer`, `NoopAiMetricsRecorder`

## Boundary Invariants

- Decoupled from specific vendor telemetry backends (Datadog, OpenTelemetry Collector, Prometheus).
- Safe by default: provides zero-overhead no-op implementations when no telemetry collector is configured.
- Conforms to OpenTelemetry GenAI standards for model tracing attributes.
