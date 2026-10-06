import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  AgentCheckpoint,
  AgentQueuePort,
  AgentRepositoryPort,
  AgentRun,
  AgentRunJob,
  AgentVersion,
  ExecuteRunLoopUseCase,
  RunRepositoryPort,
} from '@oicunt-ai/service-agents';
import { AgentJobsWorker } from '../src/worker.js';

describe('AgentJobsWorker Unit Tests', () => {
  const sampleAgent: Agent = {
    agentId: 'agent_tester' as any,
    name: 'Tester Agent',
    description: 'Testing worker execution',
    category: 'custom',
    status: 'active',
    latestVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleVersion: AgentVersion = {
    agentId: 'agent_tester' as any,
    version: '1.0.0',
    systemInstructions: 'You are a test agent.',
    defaultModel: 'canonical-test-model' as any,
    defaultEffort: 'medium',
    allowedTools: [],
    defaultBudget: {
      maxSteps: 5,
      deadlineMs: Date.now() + 60000,
      maxConsecutiveErrors: 3,
      maxModelCalls: 10,
      maxToolCalls: 10,
    },
    policy: {
      toolCallMode: 'auto',
      confirmationBehavior: 'pause_and_notify',
      privacyPolicy: { emitNormalizedThinkingEvents: false, redactThinkingInLogs: true },
      maxConsecutiveErrors: 3,
    },
    isFrozen: true,
    publishedAt: new Date().toISOString(),
  };

  const sampleRun: AgentRun = {
    runId: 'run_worker_test' as any,
    agentId: sampleAgent.agentId,
    agentVersion: '1.0.0',
    tenantId: 'ten_enterprise',
    actorId: 'usr_test',
    correlationId: 'corr_test_1',
    status: 'pending',
    budget: sampleVersion.defaultBudget,
    cumulativeUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    currentStepNumber: 0,
    startedAt: new Date().toISOString(),
  };

  const sampleJob: AgentRunJob = {
    jobId: 'job_test_01',
    runId: sampleRun.runId,
    tenantId: sampleRun.tenantId,
    actorId: sampleRun.actorId,
    correlationId: sampleRun.correlationId,
    input: 'Run background analysis',
    timestamp: new Date().toISOString(),
  };

  const createMockDeps = () => {
    let registeredHandler: ((job: AgentRunJob) => Promise<void>) | undefined;

    const mockRunRepo: RunRepositoryPort = {
      createRun: vi.fn(),
      getRun: vi.fn().mockResolvedValue(sampleRun),
      updateRunStatus: vi.fn(),
      updateRunProgress: vi.fn(),
      appendStep: vi.fn(),
      getSteps: vi.fn(),
      saveCheckpoint: vi.fn(),
      getLatestCheckpoint: vi.fn().mockResolvedValue(null),
      acquireLease: vi.fn().mockResolvedValue(true),
      renewLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(undefined),
    };

    const mockAgentRepo: AgentRepositoryPort = {
      saveAgent: vi.fn(),
      getAgent: vi.fn().mockResolvedValue(sampleAgent),
      listAgents: vi.fn(),
      saveAgentVersion: vi.fn(),
      getAgentVersion: vi.fn().mockResolvedValue(sampleVersion),
    };

    const mockExecuteRunLoopUseCase = {
      execute: vi.fn().mockResolvedValue({
        runId: sampleRun.runId,
        status: 'completed',
        finalOutput: 'Background job completed successfully.',
        totalSteps: 1,
        cumulativeUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        durationMs: 50,
      }),
    } as unknown as ExecuteRunLoopUseCase;

    const mockQueue: AgentQueuePort & {
      triggerJob: (job: AgentRunJob) => Promise<void>;
    } = {
      publishRunJob: vi.fn(),
      registerWorker: vi.fn().mockImplementation((handler) => {
        registeredHandler = handler;
      }),
      checkHealth: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      triggerJob: async (job: AgentRunJob) => {
        if (registeredHandler) {
          await registeredHandler(job);
        }
      },
    };

    return {
      runRepository: mockRunRepo,
      agentRepository: mockAgentRepo,
      executeRunLoopUseCase: mockExecuteRunLoopUseCase,
      queue: mockQueue,
    };
  };

  it('starts worker, registers queue consumer, and can be stopped', async () => {
    const deps = createMockDeps();
    const worker = new AgentJobsWorker(deps);

    await worker.start();
    expect(deps.queue.registerWorker).toHaveBeenCalled();

    await worker.stop();
    expect(deps.queue.close).toHaveBeenCalled();
  });

  it('discards run cancelled while queued without executing inference or acquiring lease', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.runRepository.getRun).mockResolvedValue({
      ...sampleRun,
      status: 'cancelled',
      terminationReason: 'cancelled_by_user',
    });

    const worker = new AgentJobsWorker(deps);
    await worker.start();
    await deps.queue.triggerJob(sampleJob);

    expect(deps.runRepository.acquireLease).not.toHaveBeenCalled();
    expect(deps.executeRunLoopUseCase.execute).not.toHaveBeenCalled();
  });

  it('discards runs already in terminal status (completed or failed)', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.runRepository.getRun).mockResolvedValue({
      ...sampleRun,
      status: 'completed',
    });

    const worker = new AgentJobsWorker(deps);
    await worker.start();
    await deps.queue.triggerJob(sampleJob);

    expect(deps.runRepository.acquireLease).not.toHaveBeenCalled();
    expect(deps.executeRunLoopUseCase.execute).not.toHaveBeenCalled();
  });

  it('does not execute if lease cannot be acquired from another worker', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.runRepository.acquireLease).mockResolvedValue(false);

    const worker = new AgentJobsWorker(deps);
    await worker.start();
    await deps.queue.triggerJob(sampleJob);

    expect(deps.runRepository.acquireLease).toHaveBeenCalledWith(
      sampleJob.runId,
      worker.getWorkerId(),
      30_000,
    );
    expect(deps.executeRunLoopUseCase.execute).not.toHaveBeenCalled();
    expect(deps.runRepository.releaseLease).not.toHaveBeenCalled();
  });

  it('acquires distributed lease, executes run loop, and releases lease on completion', async () => {
    const deps = createMockDeps();
    const worker = new AgentJobsWorker(deps);

    await worker.start();
    await deps.queue.triggerJob(sampleJob);

    expect(deps.runRepository.acquireLease).toHaveBeenCalledWith(
      sampleJob.runId,
      worker.getWorkerId(),
      30_000,
    );
    expect(deps.executeRunLoopUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ runId: sampleRun.runId, status: 'running' }),
      sampleVersion,
      sampleJob.input,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(deps.runRepository.releaseLease).toHaveBeenCalledWith(
      sampleJob.runId,
      worker.getWorkerId(),
    );
  });

  it('restores state from checkpoint when recovering after a crash', async () => {
    const deps = createMockDeps();
    const priorCheckpoint: AgentCheckpoint = {
      checkpointId: 'chk_recovered_3',
      runId: sampleRun.runId,
      stepNumber: 3,
      statePayload: {
        goalInput: 'Original goal input from checkpoint',
        scratchpad: [],
        decisionSummaries: ['Step 1 summary', 'Step 2 summary', 'Step 3 summary'],
        cumulativeUsage: { promptTokens: 300, completionTokens: 100, totalTokens: 400 },
      },
      createdAt: new Date().toISOString(),
    };

    vi.mocked(deps.runRepository.getLatestCheckpoint).mockResolvedValue(priorCheckpoint);

    const worker = new AgentJobsWorker(deps);
    await worker.start();
    await deps.queue.triggerJob(sampleJob);

    expect(deps.runRepository.getLatestCheckpoint).toHaveBeenCalledWith(sampleJob.runId);
    expect(deps.executeRunLoopUseCase.execute).toHaveBeenCalledWith(
      expect.anything(),
      sampleVersion,
      'Original goal input from checkpoint',
      expect.anything(),
    );
    expect(deps.runRepository.releaseLease).toHaveBeenCalledWith(
      sampleJob.runId,
      worker.getWorkerId(),
    );
  });

  it('releases lease in finally block if execution throws a fatal error', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.executeRunLoopUseCase.execute).mockRejectedValue(
      new Error('Fatal execution loop exception'),
    );

    const worker = new AgentJobsWorker(deps);
    await worker.start();

    await expect(deps.queue.triggerJob(sampleJob)).rejects.toThrow(
      'Fatal execution loop exception',
    );

    expect(deps.runRepository.releaseLease).toHaveBeenCalledWith(
      sampleJob.runId,
      worker.getWorkerId(),
    );
  });
});
