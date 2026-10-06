import type { TokenUsage } from '@oicunt-ai/model-types';
import type { AgentCheckpoint, AgentRun, AgentStep } from '../../domain/entities.js';
import type { AgentRunId, AgentRunStatus, TerminationReason } from '../../domain/types.js';

export interface RunRepositoryPort {
  createRun(run: AgentRun): Promise<void>;
  getRun(tenantId: string, runId: AgentRunId): Promise<AgentRun | null>;
  updateRunStatus(
    tenantId: string,
    runId: AgentRunId,
    status: AgentRunStatus,
    reason?: TerminationReason | undefined,
    finalOutput?: string | undefined,
  ): Promise<void>;
  updateRunProgress(
    tenantId: string,
    runId: AgentRunId,
    stepNumber: number,
    usage: TokenUsage,
  ): Promise<void>;
  appendStep(step: AgentStep): Promise<void>;
  getSteps(runId: AgentRunId): Promise<readonly AgentStep[]>;
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void>;
  getLatestCheckpoint(runId: AgentRunId): Promise<AgentCheckpoint | null>;

  // Worker lease management
  acquireLease(runId: AgentRunId, workerId: string, leaseDurationMs: number): Promise<boolean>;
  renewLease(runId: AgentRunId, workerId: string, leaseDurationMs: number): Promise<boolean>;
  releaseLease(runId: AgentRunId, workerId: string): Promise<void>;
}
