import { ToolNotFoundError } from '../../domain/index.js';
import type { ToolRepositoryPort } from '../ports/tool-repository.port.js';

export interface CancelExecutionCommand {
  readonly executionId: string;
  readonly tenantId: string;
}

export class CancelExecutionUseCase {
  constructor(private readonly repository: ToolRepositoryPort) {}

  public async execute(
    command: CancelExecutionCommand,
  ): Promise<{ readonly executionId: string; readonly status: 'cancelled' }> {
    const job = await this.repository.getAsyncExecution(command.executionId);
    if (!job || job.tenantId !== command.tenantId) {
      throw new ToolNotFoundError(`Execution job '${command.executionId}' was not found`);
    }

    if (job.status === 'pending' || job.status === 'running') {
      await this.repository.updateAsyncExecution(command.executionId, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
    }

    return {
      executionId: command.executionId,
      status: 'cancelled',
    };
  }
}
