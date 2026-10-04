# Embeddings Worker (`workers/embeddings/`)

Asynchronous background worker responsible for batch vector embedding generation and vector store ingestion.

---

## 1. Scope & Responsibility

- Consumes embedding jobs containing batches of text chunks.
- Coordinates with model inference endpoints or embedding providers to generate high-dimensional vector embeddings.
- Manages batching optimizations, rate-limit backpressure, and vector store write transactions.

## 2. Invariants

- Must handle retries and partial batch failures gracefully.
- Emits token usage and vector generation latency metrics via `@oicunt-ai/observability`.
- Never mixes document extraction logic into the embedding worker; receives pre-chunked semantic text.
