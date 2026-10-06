import { RunNotFoundError } from '../../domain/errors.js';
import type { AgentRunId } from '../../domain/types.js';
import type { AgentStepDto } from '../dtos/agent-run-response.dto.js';
import type { RunRepositoryPort } from '../ports/index.js';

export interface GetStepsContext {
  readonly tenantId: string;
}

export class GetStepsUseCase {
  constructor(private readonly runRepository: RunRepositoryPort) {}

  public async execute(
    runId: AgentRunId,
    context: GetStepsContext,
  ): Promise<readonly AgentStepDto[]> {
    const run = await this.runRepository.getRun(context.tenantId, runId);
    if (!run) {
      throw new RunNotFoundError(runId);
    }

    const steps = await this.runRepository.getSteps(runId);
    return steps;
  }
}
