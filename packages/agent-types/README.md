# `@oicunt-ai/agent-types`

Agent configurations, execution loops, step tracking, state machines, and run context definitions for the OICUNT AI Platform.

---

## Scope

- Agent identifiers & configurations: `AgentConfig`, `AgentId`, `AgentRunId`
- Lifecycle states: `AgentExecutionStatus`
- Step definitions & transitions: `AgentStepType`, `AgentStep`
- Execution run contexts: `AgentRunContext`
- Final execution run results: `AgentRunResult`

## Boundary Invariants

- Defines the contract for autonomous agent execution loops without implementing specific agent frameworks.
- Integrates canonical models from `@oicunt-ai/model-types`, messages from `@oicunt-ai/ai-types`, and tool specifications from `@oicunt-ai/tool-types`.
- Enforces correlation ID propagation and explicit step accounting.
