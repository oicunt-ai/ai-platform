import { randomUUID } from 'node:crypto';
import type {
  AgentQueuePort,
  AgentRepositoryPort,
  AgentRunJob,
  RunRepositoryPort,
} from '@oicunt-ai/service-agents';
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  ExecuteRunLoopUseCase,
  JsonLogger,
} from '@oicunt-ai/service-agents';

export interface AgentJobsWorkerDependencies {
  readonly runRepository: RunRepositoryPort;
  readonly agentRepository: AgentRepositoryPort;
  readonly executeRunLoopUseCase: ExecuteRunLoopUseCase;
  readonly queue: AgentQueuePort;
  readonly logger?: JsonLogger | undefined;
  readonly workerId?: string | undefined;
  readonly leaseDurationMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
}

export class AgentJobsWorker {
  private readonly runRepository: RunRepositoryPort;
  private readonly agentRepository: AgentRepositoryPort;
  private readonly executeRunLoopUseCase: ExecuteRunLoopUseCase;
  private readonly queue: AgentQueuePort;
  private readonly logger: JsonLogger;
  private readonly workerId: string;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;

  private isRunning = false;

  constructor(deps: AgentJobsWorkerDependencies) {
    this.runRepository = deps.runRepository;
    this.agentRepository = deps.agentRepository;
    this.executeRunLoopUseCase = deps.executeRunLoopUseCase;
    this.queue = deps.queue;
    this.logger =
      deps.logger ??
      new JsonLogger('worker-agent-jobs', 'info', {
        worker: 'agent-jobs',
      });
    this.workerId = deps.workerId ?? `worker_${process.pid}_${randomUUID().slice(0, 8)}`;
    this.leaseDurationMs = deps.leaseDurationMs ?? 30_000;
    this.heartbeatIntervalMs = deps.heartbeatIntervalMs ?? 10_000;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    this.logger.info(`Starting AgentJobsWorker [${this.workerId}]`, {
      workerId: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
    });

    if (typeof this.queue.registerWorker === 'function') {
      this.queue.registerWorker(async (job: AgentRunJob) => {
        await this.handleJob(job);
      });
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    this.logger.info(`Stopping AgentJobsWorker [${this.workerId}]`, {
      workerId: this.workerId,
    });

    if (this.queue && typeof this.queue.close === 'function') {
      await this.queue.close();
    }
  }

  public async handleJob(job: AgentRunJob): Promise<void> {
    this.logger.info(`Received job for run '${job.runId}'`, {
      jobId: job.jobId,
      runId: job.runId,
      tenantId: job.tenantId,
      correlationId: job.correlationId,
    });

    // 1. Initial State Check: Queued vs Active Cancellation
    const run = await this.runRepository.getRun(job.tenantId, job.runId);
    if (!run) {
      this.logger.warn(`Run '${job.runId}' not found. Discarding job.`);
      return;
    }

    if (run.status === 'cancelled') {
      this.logger.info(
        `Run '${job.runId}' was cancelled while queued. Discarding job without execution.`,
        { runId: job.runId },
      );
      return;
    }

    if (run.status === 'completed' || run.status === 'failed') {
      this.logger.info(
        `Run '${job.runId}' is already in terminal status '${run.status}'. Discarding job.`,
        { runId: job.runId, status: run.status },
      );
      return;
    }

    // 2. Distributed Lease Acquisition
    const hasLease = await this.runRepository.acquireLease(
      job.runId,
      this.workerId,
      this.leaseDurationMs,
    );
    if (!hasLease) {
      this.logger.warn(
        `Could not acquire lease for run '${job.runId}'. Another worker owns active lease.`,
        { runId: job.runId, workerId: this.workerId },
      );
      return;
    }

    // 3. Heartbeat maintenance
    let heartbeatActive = true;
    const heartbeatTimer = setInterval(async () => {
      if (!heartbeatActive) return;
      try {
        const renewed = await this.runRepository.renewLease(
          job.runId,
          this.workerId,
          this.leaseDurationMs,
        );
        if (!renewed) {
          this.logger.warn(
            `Lease renewal returned false for run '${job.runId}'. Lost lease ownership.`,
            { runId: job.runId, workerId: this.workerId },
          );
        }
      } catch (err: unknown) {
        this.logger.error(`Error during lease renewal heartbeat for run '${job.runId}': ${err}`, {
          runId: job.runId,
          error: String(err),
        });
      }
    }, this.heartbeatIntervalMs);

    const abortController = new AbortController();

    try {
      // 4. Resolve Agent and Version
      const agent = await this.agentRepository.getAgent(run.agentId);
      if (!agent) {
        throw new AgentNotFoundError(run.agentId);
      }

      const version = await this.agentRepository.getAgentVersion(run.agentId, run.agentVersion);
      if (!version) {
        throw new AgentVersionNotFoundError(run.agentId, run.agentVersion);
      }

      // 5. Crash Recovery: Check for prior checkpoint
      const latestCheckpoint = await this.runRepository.getLatestCheckpoint(job.runId);
      const goalInput =
        latestCheckpoint?.statePayload.goalInput ?? job.input ?? run.finalOutput ?? '';

      if (latestCheckpoint) {
        this.logger.info(
          `Recovering execution from step ${latestCheckpoint.stepNumber} for run '${job.runId}'`,
          {
            runId: job.runId,
            stepNumber: latestCheckpoint.stepNumber,
          },
        );
      }

      // 6. Execute Run Loop
      await this.executeRunLoopUseCase.execute({ ...run, status: 'running' }, version, goalInput, {
        signal: abortController.signal,
      });
    } catch (err: unknown) {
      this.logger.error(`Fatal failure processing agent job for run '${job.runId}'`, {
        runId: job.runId,
        error: String(err),
      });
      throw err;
    } finally {
      heartbeatActive = false;
      clearInterval(heartbeatTimer);
      try {
        await this.runRepository.releaseLease(job.runId, this.workerId);
      } catch (err: unknown) {
        this.logger.error(`Error releasing lease for run '${job.runId}': ${err}`);
      }
    }
  }

  public getWorkerId(): string {
    return this.workerId;
  }
}
