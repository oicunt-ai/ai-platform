# AI Platform Workers (`workers/`)

This directory houses asynchronous background workers and batch processing daemons for the **OICUNT AI Platform**.

---

## 1. Architectural Role & Principles

Workers execute decoupled, high-latency, or compute-intensive AI operations that must not block synchronous HTTP request threads.

### Core Worker Invariants

- **Hexagonal Worker Architecture**: Workers follow the same Clean / Hexagonal Architecture as services:
  ```
  interfaces (Job Consumers: Queue subscribers, cron triggers, dead-letter handlers)
      ↓
  application (Job Handlers: Batch orchestrator, task use cases, DTOs)
      ↓
  domain (Domain Invariants: Chunking rules, agent step state models, retry policies)
      ↓
  infrastructure (Outbound Adapters: Vector databases, object storage, event publishers)
  ```
- **Strict Idempotency**: Distributed message brokers guarantee at-least-once delivery. All job handlers must be idempotent by checking and recording processed job identifiers.
- **Decoupled from Company Platform Workers**: General enterprise background jobs (billing reconciliations, email dispatches, user data purges) belong in the company platform repository. Only **AI-specific** processing workloads live here.
- **Resource Profiling & Isolation**: Workers have dedicated scaling profiles, memory limits, and node selector assignments (including specialized GPU worker pools for batch embedding generation).
- **Graceful Shutdown**: On `SIGTERM` / `SIGINT`, workers stop consuming new jobs, allow current in-flight tasks to complete within a timeout window, and cleanly flush open connections.

---

## 2. Worker Boundaries Landscape

```
workers/
├── embeddings/             # Batch vector embedding computation and index ingestion
├── document-processing/    # Multi-format parsing, chunking, OCR, and semantic preprocessing
└── agent-jobs/             # Long-running autonomous agent tasks, scheduled runs, and step loops
```

### Detailed Worker Specifications

| Worker Boundary                                | Primary Responsibility                                                                                              | Inbound Contract                                                                | Processing Mechanics                                                                                   | Outbound Target                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [`embeddings`](./embeddings)                   | Computes high-throughput vector embeddings for text chunks in batches.                                              | Chunk batches & canonical embedding model ID (`oicunt.model.catalog-embedding`) | Batched vector inference via Model Gateway or dedicated inference runtime. Enforces backpressure.      | Vector index / vector datastore                        |
| [`document-processing`](./document-processing) | Ingests documents (PDF, DOCX, XLSX, HTML, TXT), parses structure, extracts text/OCR, and applies semantic chunking. | Document storage URI & parser options                                           | Sandboxed document extraction; hierarchical token chunking preserving section provenance.              | Normalized semantic chunks emitted to embeddings queue |
| [`agent-jobs`](./agent-jobs)                   | Executes asynchronous multi-step agent workflows and scheduled tasks.                                               | Agent run context (`AgentRunContext`) & task payload                            | ReAct execution loop (thought &rarr; action &rarr; observation). Checkpoints intermediate step states. | Agent run result (`AgentRunResult`) & audit events     |

---

## 3. Worker Implementation Standards (For Future Milestones)

1. **Dead-Letter Queues (DLQ)**: Every worker pipeline must define a maximum retry budget with exponential backoff before routing failed jobs to a DLQ for inspection.
2. **Telemetry**: Workers emit batch latency, token usage, and processing success/error counts using `@oicunt-ai/observability`.
3. **Correlation Tracking**: Workers propagate incoming `correlationId` through all downstream logs, metrics, and published events.
