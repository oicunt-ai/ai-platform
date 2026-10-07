import type { ToolParametersSchema } from '@oicunt-ai/tool-types';
import type { McpServerCapabilities } from '@oicunt-ai/mcp-types';

export type ToolId = `oicunt.tool.${string}`;

export interface CanonicalToolDefinition {
  readonly toolId: ToolId;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly category: string;
  readonly source: 'mcp';
  readonly capabilities: {
    readonly isReadOnly: boolean;
    readonly hasSideEffects: boolean;
    readonly requiresConfirmation: boolean;
    readonly networkEgress: boolean;
    readonly accessesSensitiveData: boolean;
  };
  readonly parameters: ToolParametersSchema;
  readonly outputSchema?: Record<string, unknown> | undefined;
  readonly timeoutPolicy: {
    readonly defaultTimeoutMs: number;
    readonly maxTimeoutMs: number;
  };
  readonly status: 'active' | 'deprecated' | 'disabled';
  readonly tags?: readonly string[] | undefined;
}

export type McpServerId = string;
export type McpSessionId = string;

export type McpTransportType = 'streamable_http' | 'stdio' | 'sse';

export type McpServerStatus = 'active' | 'inactive' | 'error' | 'disconnected';

export interface StreamableHttpTransportConfig {
  readonly url: string;
  readonly headers?: Record<string, string> | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface StdioTransportConfig {
  readonly command: string;
  readonly args?: readonly string[] | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly cwd?: string | undefined;
  readonly maxBufferBytes?: number | undefined;
}

export interface LegacySseTransportConfig {
  readonly url: string;
  readonly headers?: Record<string, string> | undefined;
  readonly timeoutMs?: number | undefined;
}

export type McpTransportConfig =
  | { readonly type: 'streamable_http'; readonly config: StreamableHttpTransportConfig }
  | { readonly type: 'stdio'; readonly config: StdioTransportConfig }
  | { readonly type: 'sse'; readonly config: LegacySseTransportConfig };

export interface McpServerRegistration {
  readonly serverId: McpServerId;
  readonly tenantId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly transportType: McpTransportType;
  readonly transportConfig: McpTransportConfig;
  readonly authSecretRef?: string | undefined;
  readonly status: McpServerStatus;
  readonly protocolVersion: string;
  readonly capabilities: McpServerCapabilities;
  readonly lastDiscoveredAt?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpToolDescriptor {
  readonly id: string;
  readonly serverId: McpServerId;
  readonly tenantId: string;
  readonly originalName: string;
  readonly canonicalToolId: ToolId;
  readonly description: string;
  readonly inputSchema: ToolParametersSchema;
  readonly schemaHash: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpResourceDescriptor {
  readonly id: string;
  readonly serverId: McpServerId;
  readonly tenantId: string;
  readonly uri: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpPromptArgument {
  readonly name: string;
  readonly description?: string | undefined;
  readonly required?: boolean | undefined;
}

export interface McpPromptDescriptor {
  readonly id: string;
  readonly serverId: McpServerId;
  readonly tenantId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly arguments: readonly McpPromptArgument[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpDiscoveredCapabilities {
  readonly tools: readonly McpToolDescriptor[];
  readonly resources: readonly McpResourceDescriptor[];
  readonly prompts: readonly McpPromptDescriptor[];
  readonly rawServerCapabilities: McpServerCapabilities;
}

export interface McpSessionState {
  readonly sessionId: McpSessionId;
  readonly serverId: McpServerId;
  readonly tenantId: string;
  readonly transportType: McpTransportType;
  readonly isConnected: boolean;
  readonly connectedAt: string;
  readonly lastHeartbeatAt: string;
}
