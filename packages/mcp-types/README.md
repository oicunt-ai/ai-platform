# `@oicunt-ai/mcp-types`

Model Context Protocol (MCP) specifications, framing, transports, resources, prompts, and tools interfaces for the OICUNT AI Platform.

---

## Scope

- Protocol version: `MCP_LATEST_PROTOCOL_VERSION` (`2024-11-05`)
- Transport primitives: `McpTransportType` (`stdio`, `sse`, `websocket`)
- Server & Client descriptors: `McpServerDescriptor`, `McpClientDescriptor`
- Capabilities: `McpServerCapabilities`, `McpClientCapabilities`
- Primitives: `McpResource`, `McpPrompt`, `McpTool`
- JSON-RPC 2.0 message envelope structures: `McpRequest`, `McpResponse`, `McpNotification`

## Boundary Invariants

- Implements canonical MCP wire types without coupling to concrete server processes.
- Interoperates cleanly with `@oicunt-ai/tool-types`.
- Strict typing on JSON-RPC 2.0 messages.
