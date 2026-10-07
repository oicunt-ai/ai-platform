import type { ToolParametersSchema } from '@oicunt-ai/tool-types';

/**
 * Canonical Model Context Protocol version identifier.
 */
export const MCP_LATEST_PROTOCOL_VERSION = '2024-11-05';

/**
 * Underlying transport channel for MCP connections.
 */
export type McpTransportType = 'stdio' | 'streamable_http' | 'sse' | 'websocket';

/**
 * Capabilities declared by an MCP Server during handshake.
 */
export interface McpServerCapabilities {
  readonly logging?: Record<string, unknown>;
  readonly prompts?: { readonly listChanged?: boolean };
  readonly resources?: { readonly subscribe?: boolean; readonly listChanged?: boolean };
  readonly tools?: { readonly listChanged?: boolean };
}

/**
 * Capabilities declared by an MCP Client during handshake.
 */
export interface McpClientCapabilities {
  readonly experimental?: Record<string, unknown>;
  readonly sampling?: Record<string, unknown>;
  readonly roots?: { readonly listChanged?: boolean };
}

/**
 * Identity and version metadata of an MCP host/client.
 */
export interface McpImplementationInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Full descriptor for an MCP Server.
 */
export interface McpServerDescriptor {
  readonly info: McpImplementationInfo;
  readonly protocolVersion: string;
  readonly capabilities: McpServerCapabilities;
}

/**
 * Full descriptor for an MCP Client.
 */
export interface McpClientDescriptor {
  readonly info: McpImplementationInfo;
  readonly protocolVersion: string;
  readonly capabilities: McpClientCapabilities;
}

/**
 * An external resource exposed via MCP.
 */
export interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/**
 * A reusable prompt template exposed via MCP.
 */
export interface McpPrompt {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

/**
 * An executable tool exposed via MCP.
 */
export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: ToolParametersSchema;
}

/**
 * Standard JSON-RPC 2.0 Request message.
 */
export interface McpJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/**
 * Standard JSON-RPC 2.0 Response error structure.
 */
export interface McpJsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * Standard JSON-RPC 2.0 Response message.
 */
export interface McpJsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: McpJsonRpcError;
}

/**
 * Standard JSON-RPC 2.0 Notification message.
 */
export interface McpJsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/**
 * Domain error for Model Context Protocol interactions.
 */
export class McpProtocolError extends Error {
  public readonly rpcCode: number;

  constructor(message: string, rpcCode = -32603) {
    super(message);
    this.name = 'McpProtocolError';
    this.rpcCode = rpcCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
