import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  InvalidRequestError,
  InvalidRunStateError,
  RunNotFoundError,
} from '../../domain/errors.js';
import type { AgentRunId } from '../../domain/types.js';
import type { AgentStreamEvent } from '../dtos/agent-run-response.dto.js';
import type { ResumeRunDto } from '../dtos/resume-run.dto.js';
import type { AgentRepositoryPort, RunRepositoryPort } from '../ports/index.js';
import type { ExecuteRunLoopUseCase, RunLoopResult } from './execute-run-loop.use-case.js';

export interface ResumeRunContext {
  readonly tenantId: string;
  readonly actorId: string;
}

export interface ResumeRunOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onEvent?: ((event: AgentStreamEvent) => void) | undefined;
}

export class ResumeRunUseCase {
  constructor(
    private readonly agentRepository: AgentRepositoryPort,
    private readonly runRepository: RunRepositoryPort,
    private readonly executeRunLoopUseCase: ExecuteRunLoopUseCase,
  ) {}

  public async execute(
    runId: AgentRunId,
    dto: ResumeRunDto,
    context: ResumeRunContext,
    options: ResumeRunOptions = {},
  ): Promise<RunLoopResult> {
    const run = await this.runRepository.getRun(context.tenantId, runId);
    if (!run) {
      throw new RunNotFoundError(runId);
    }

    if (run.status !== 'waiting_for_confirmation' && run.status !== 'waiting_for_input') {
      throw new InvalidRunStateError(
        `Cannot resume run '${runId}' in status '${run.status}'. Only 'waiting_for_confirmation' or 'waiting_for_input' can be resumed.`,
      );
    }

    if (run.status === 'waiting_for_confirmation' && !dto.confirmationToken) {
      throw new InvalidRequestError('confirmationToken is required to resume from confirmation');
    }

    if (run.status === 'waiting_for_input' && dto.value === undefined) {
      throw new InvalidRequestError('value is required to resume from user input');
    }

    const checkpoint = await this.runRepository.getLatestCheckpoint(runId);
    if (!checkpoint) {
      throw new InvalidRunStateError(`No checkpoint found to resume run '${runId}'`);
    }

    const agent = await this.agentRepository.getAgent(run.agentId);
    if (!agent) {
      throw new AgentNotFoundError(run.agentId);
    }

    const version = await this.agentRepository.getAgentVersion(run.agentId, run.agentVersion);
    if (!version) {
      throw new AgentVersionNotFoundError(run.agentId, run.agentVersion);
    }

    // Transition back to running
    await this.runRepository.updateRunStatus(context.tenantId, runId, 'running');

    return await this.executeRunLoopUseCase.execute(
      { ...run, status: 'running' },
      version,
      checkpoint.statePayload.goalInput,
      {
        ...options,
        resumePayload: dto,
      },
    );
  }
}
