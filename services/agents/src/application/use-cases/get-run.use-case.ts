import { RunNotFoundError } from '../../domain/errors.js';
import type { AgentRunId } from '../../domain/types.js';
import type { AgentRunDetailDto } from '../dtos/agent-run-response.dto.js';
import type { RunRepositoryPort } from '../ports/index.js';

export interface GetRunContext {
  readonly tenantId: string;
}

export class GetRunUseCase {
  constructor(private readonly runRepository: RunRepositoryPort) {}

  public async execute(runId: AgentRunId, context: GetRunContext): Promise<AgentRunDetailDto> {
    const run = await this.runRepository.getRun(context.tenantId, runId);
    if (!run) {
      throw new RunNotFoundError(runId);
    }

    const steps = await this.runRepository.getSteps(runId);
    const checkpoint = await this.runRepository.getLatestCheckpoint(runId);

    const startedMs = new Date(run.startedAt).getTime();
    const completedMs = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();

    return {
      runId: run.runId,
      agentId: run.agentId,
      version: run.agentVersion,
      tenantId: run.tenantId,
      actorId: run.actorId,
      correlationId: run.correlationId,
      conversationId: run.conversationId,
      status: run.status,
      currentStepNumber: run.currentStepNumber,
      budget: run.budget,
      cumulativeUsage: run.cumulativeUsage,
      finalOutput: run.finalOutput,
      terminationReason: run.terminationReason,
      durationMs: completedMs - startedMs,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      steps,
      pendingChallenge: checkpoint?.pendingChallenge,
    };
  }
}
