import { randomUUID } from 'node:crypto';
import type { AgentRun } from '../../domain/entities.js';
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  InvalidRequestError,
} from '../../domain/errors.js';
import type { AgentRunId } from '../../domain/types.js';
import { resolveExecutionBudget } from '../../domain/value-objects.js';
import type { AgentStreamEvent } from '../dtos/agent-run-response.dto.js';
import type { StartRunDto } from '../dtos/start-run.dto.js';
import type { AgentQueuePort, AgentRepositoryPort, RunRepositoryPort } from '../ports/index.js';
import type { ExecuteRunLoopUseCase, RunLoopResult } from './execute-run-loop.use-case.js';

export interface StartRunContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface StartRunOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onEvent?: ((event: AgentStreamEvent) => void) | undefined;
}

export class StartRunUseCase {
  constructor(
    private readonly agentRepository: AgentRepositoryPort,
    private readonly runRepository: RunRepositoryPort,
    private readonly queue: AgentQueuePort,
    private readonly executeRunLoopUseCase: ExecuteRunLoopUseCase,
  ) {}

  public async execute(
    dto: StartRunDto,
    context: StartRunContext,
    options: StartRunOptions = {},
  ): Promise<RunLoopResult> {
    if (!dto.agentId) {
      throw new InvalidRequestError('agentId is required');
    }
    if (!dto.input || dto.input.trim().length === 0) {
      throw new InvalidRequestError('input is required and cannot be empty');
    }

    const agent = await this.agentRepository.getAgent(dto.agentId);
    if (!agent) {
      throw new AgentNotFoundError(dto.agentId);
    }

    const versionId = dto.version ?? agent.latestVersion;
    const version = await this.agentRepository.getAgentVersion(dto.agentId, versionId);
    if (!version) {
      throw new AgentVersionNotFoundError(dto.agentId, versionId);
    }

    const budget = resolveExecutionBudget(dto.budget, version.defaultBudget, dto.budget?.timeoutMs);

    const runId = `run_${randomUUID()}` as AgentRunId;
    const mode = dto.mode ?? 'sync';
    const initialStatus = mode === 'async' ? 'pending' : 'running';

    const run: AgentRun = {
      runId,
      agentId: agent.agentId,
      agentVersion: version.version,
      tenantId: context.tenantId,
      actorId: context.actorId,
      correlationId: context.correlationId,
      conversationId: dto.conversationId,
      status: initialStatus,
      budget,
      cumulativeUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      currentStepNumber: 0,
      startedAt: new Date().toISOString(),
    };

    await this.runRepository.createRun(run);

    options.onEvent?.({
      event: 'run_started',
      data: {
        runId: run.runId,
        agentId: run.agentId,
        version: run.agentVersion,
        budget: run.budget,
      },
    });

    if (mode === 'async') {
      await this.runRepository.saveCheckpoint({
        checkpointId: `chk_${run.runId}_0`,
        runId: run.runId,
        stepNumber: 0,
        statePayload: {
          goalInput: dto.input,
          scratchpad: [],
          decisionSummaries: [],
          cumulativeUsage: run.cumulativeUsage,
        },
        createdAt: new Date().toISOString(),
      });

      await this.queue.publishRunJob({
        jobId: `job_${randomUUID()}`,
        runId: run.runId,
        tenantId: context.tenantId,
        actorId: context.actorId,
        correlationId: context.correlationId,
        input: dto.input,
        timestamp: new Date().toISOString(),
      });

      return {
        runId: run.runId,
        status: 'pending',
        totalSteps: 0,
        cumulativeUsage: run.cumulativeUsage,
        durationMs: 0,
      };
    }

    return await this.executeRunLoopUseCase.execute(run, version, dto.input, options);
  }
}
