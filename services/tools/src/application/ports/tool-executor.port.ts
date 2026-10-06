import type {
  ToolArtifactRef,
  ToolDefinition,
  ToolErrorDto,
  ToolExecutionRequest,
} from '../../domain/index.js';

export interface ToolExecutionContext {
  readonly executionId: string;
  readonly correlationId: string;
  readonly callerId: string;
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly cancellationSignal?: AbortSignal | undefined;
}

export interface ToolExecutionOutput {
  readonly executionId: string;
  readonly callId: string;
  readonly status: 'success' | 'failure';
  readonly output?: unknown | undefined;
  readonly textSummary?: string | undefined;
  readonly artifacts?: readonly ToolArtifactRef[] | undefined;
  readonly error?: ToolErrorDto | undefined;
  readonly durationMs: number;
}

export interface ToolExecutorPort {
  execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput>;
}
