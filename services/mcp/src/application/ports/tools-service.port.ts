import type { CanonicalToolDefinition } from '../../domain/types.js';

export interface DiscoveredMcpTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: Record<string, unknown>;
}

export interface GatewayExecuteToolCommand {
  readonly toolId: string;
  readonly callId: string;
  readonly arguments: Record<string, unknown>;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly roles?: readonly string[] | undefined;
  readonly correlationId: string;
  readonly requestId: string;
  readonly deadlineAt?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly confirmationToken?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface GatewayToolExecutionOutcome {
  readonly status: 'success' | 'failure' | 'confirmation_required';
  readonly output?: unknown | undefined;
  readonly textSummary?: string | undefined;
  readonly error?:
    | {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
        readonly details?: unknown | undefined;
      }
    | undefined;
  readonly challenge?:
    | {
        readonly challengeToken: string;
        readonly toolId: string;
        readonly expiresAt: string;
        readonly confirmationId?: string | undefined;
      }
    | undefined;
  readonly durationMs: number;
}

export interface ToolsServicePort {
  /**
   * Phase 1: Inbound tool registration into canonical Tools Service.
   */
  registerTool(tool: CanonicalToolDefinition, tenantId?: string): Promise<void>;

  /**
   * Phase 2: Query canonical tools permitted for tenant/actor projected to MCP schema.
   */
  listTools(
    tenantId: string,
    actorId: string,
    roles?: readonly string[] | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<readonly DiscoveredMcpTool[]>;

  /**
   * Phase 2: Execute canonical tool through the Tools Service execution boundary.
   */
  executeTool(command: GatewayExecuteToolCommand): Promise<GatewayToolExecutionOutcome>;
}
