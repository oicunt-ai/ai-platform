import type { AgentRunId } from '../../domain/types.js';

export interface AgentRunJob {
  readonly jobId: string;
  readonly runId: AgentRunId;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly input?: string | undefined;
  readonly timestamp: string;
}

export interface AgentQueuePort {
  publishRunJob(job: AgentRunJob): Promise<void>;
  registerWorker?(handler: (job: AgentRunJob) => Promise<void>): void;
  checkHealth(signal?: AbortSignal): Promise<boolean>;
  close?(): Promise<void>;
}
