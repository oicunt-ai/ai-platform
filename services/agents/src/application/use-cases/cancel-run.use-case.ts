import { InvalidRunStateError, RunNotFoundError } from '../../domain/errors.js';
import type { AgentRunId } from '../../domain/types.js';
import type { CancelRunDto } from '../dtos/cancel-run.dto.js';
import type { RunRepositoryPort } from '../ports/index.js';

export interface CancelRunContext {
  readonly tenantId: string;
}

export class CancelRunUseCase {
  constructor(private readonly runRepository: RunRepositoryPort) {}

  public async execute(
    runId: AgentRunId,
    dto: CancelRunDto,
    context: CancelRunContext,
  ): Promise<{ readonly runId: AgentRunId; readonly status: 'cancelled' }> {
    const run = await this.runRepository.getRun(context.tenantId, runId);
    if (!run) {
      throw new RunNotFoundError(runId);
    }

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      throw new InvalidRunStateError(
        `Cannot cancel run '${runId}' because it is already in terminal status '${run.status}'`,
      );
    }

    await this.runRepository.updateRunStatus(
      context.tenantId,
      runId,
      'cancelled',
      'cancelled_by_user',
      dto.reason,
    );

    return {
      runId,
      status: 'cancelled',
    };
  }
}
