import type { AsyncExecutionJob } from '../../domain/index.js';
import { ToolNotFoundError } from '../../domain/index.js';
import type { ToolRepositoryPort } from '../ports/tool-repository.port.js';

export interface GetExecutionStatusQuery {
  readonly executionId: string;
  readonly tenantId: string;
}

export class GetExecutionStatusUseCase {
  constructor(private readonly repository: ToolRepositoryPort) {}

  public async execute(query: GetExecutionStatusQuery): Promise<AsyncExecutionJob> {
    const job = await this.repository.getAsyncExecution(query.executionId);
    if (!job || job.tenantId !== query.tenantId) {
      throw new ToolNotFoundError(`Execution job '${query.executionId}' was not found`);
    }

    return job;
  }
}
