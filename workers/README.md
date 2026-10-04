# AI Platform Workers (`workers/`)

This directory houses asynchronous background workers and batch processing daemons for the **OICUNT AI Platform**.

---

## 1. Architectural Role

Workers execute decoupled, high-latency, or compute-intensive AI operations that must not block synchronous HTTP request threads.

### Boundary Principles

- **Event-Driven & Queue-Driven**: Workers consume jobs from messaging backplanes or job queues, run asynchronously, and publish completion events or write results to designated storage.
- **Strict Idempotency**: Due to distributed at-least-once delivery guarantees, all worker job handlers must be idempotent.
- **Decoupled from Company Platform Workers**: General enterprise background jobs (email sending, user billing cycle reconciliations, analytics exports) belong in the company platform repository. Only **AI-specific** processing workloads live here.
- **Resource Profiling & Isolation**: Workers have dedicated scaling profiles, memory limits, and node selector assignments (including GPU worker pools for embedding generation).

---

## 2. Worker Boundaries

```
workers/
├── embeddings/             # Batch vector embedding computation and index ingestion
├── document-processing/    # Multi-format parsing, chunking, OCR, and semantic preprocessing
└── agent-jobs/             # Long-running autonomous agent tasks, scheduled runs, and step loops
```

| Worker Boundary                                | Primary Responsibility                                                            | Input Contract                        | Output Target                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| [`embeddings`](./embeddings)                   | Computes high-throughput vector embeddings for text chunks.                       | Chunk batches & embedding model ID    | Vector index / vector datastore |
| [`document-processing`](./document-processing) | Ingests documents (PDF, DOCX, Markdown, HTML), parses, extracts, and chunks text. | Document storage URI & parser options | Normalized semantic chunks      |
| [`agent-jobs`](./agent-jobs)                   | Executes asynchronous multi-step agent workflows and scheduled tasks.             | Agent run context & task payload      | Agent run result & audit events |

---

## 3. Implementation Status

> [!NOTE]
> In accordance with the repository foundation milestones, **no concrete worker implementations, queues, or consumers are created yet**.
> Dedicated worker implementations will be added during their respective architectural slices.
