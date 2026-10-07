import type {
  McpDiscoveredCapabilities,
  McpServerId,
  McpServerRegistration,
  McpTransportConfig,
  McpTransportType,
} from '../../domain/types.js';

export interface RegisterServerDto {
  readonly tenantId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly transportType: McpTransportType;
  readonly transportConfig: McpTransportConfig;
  readonly authSecretRef?: string | undefined;
}

export interface ExecuteMcpToolDto {
  readonly tenantId: string;
  readonly serverId: McpServerId;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly actorId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ExecuteMcpToolResultDto {
  readonly content: readonly unknown[];
  readonly isError?: boolean | undefined;
  readonly durationMs: number;
}

export interface McpServerDetailDto {
  readonly server: McpServerRegistration;
  readonly capabilities: McpDiscoveredCapabilities | null;
}
