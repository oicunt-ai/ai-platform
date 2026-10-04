# `@oicunt-ai/tool-types`

Standardized JSON schema parameter descriptions, tool definitions, tool invocations, execution contexts, and tool result specifications for the OICUNT AI Platform.

---

## Scope

- JSON Schema representations: `JsonSchemaProperty`, `ToolParametersSchema`
- Tool registration definitions: `ToolDefinition`
- Tool calls and results: `ToolCall`, `ToolResult`
- Execution lifecycle & execution context: `ToolExecutionContext`, `ToolExecutor`
- Errors: `ToolExecutionError`

## Boundary Invariants

- Tool interfaces are decoupled from specific external tools or sandboxes.
- Tool arguments and results follow strict JSON serializability.
- Execution contexts enforce correlation ID propagation and strict execution timeouts.
