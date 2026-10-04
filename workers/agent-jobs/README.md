# Agent Jobs Worker (`workers/agent-jobs/`)

Asynchronous background worker responsible for executing long-running, multi-step autonomous agent runs and scheduled agent jobs.

---

## 1. Scope & Responsibility

- Consumes background agent task requests dispatched from user interactions or scheduled crons.
- Executes iterative agent loops (thought, tool action, observation, response) defined by `@oicunt-ai/agent-types`.
- Persists intermediate step states and checkpoints to support interruption, pause, and resumption.
- Publishes execution status updates and terminal run summaries.

## 2. Invariants

- Must enforce hard step limits (`maxSteps`) and timeout budgets to prevent infinite agent execution loops.
- All tool executions are validated against allowed tool permissions.
- Emits detailed token usage and step telemetry using `@oicunt-ai/observability`.
