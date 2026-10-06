import { describe, expect, it } from 'vitest';
import { InMemoryAgentRepository } from '../../src/infrastructure/repositories/in-memory-agent.repository.js';
import { InMemoryRunRepository } from '../../src/infrastructure/repositories/in-memory-run.repository.js';
import { InMemoryAgentQueue } from '../../src/infrastructure/queue/in-memory-agent-queue.js';
import {
  CancelRunUseCase,
  GetRunUseCase,
  GetStepsUseCase,
  ResumeRunUseCase,
  StartRunUseCase,
} from '../../src/application/use-cases/index.js';
import { ExecuteRunLoopUseCase } from '../../src/application/use-cases/execute-run-loop.use-case.js';
import type { InferenceClientPort } from '../../src/application/ports/inference-client.port.js';
import type { ToolsClientPort } from '../../src/application/ports/tools-client.port.js';

describe('Start, Resume, Cancel Run Use Cases', () => {
  const dummyInference: InferenceClientPort = {
    execute: async () => ({
      completionId: 'comp_dummy',
      message: { role: 'assistant', content: 'Done.' },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }),
  };

  const dummyTools: ToolsClientPort = {
    executeTool: async () => ({
      status: 'success',
      output: {},
      durationMs: 5,
    }),
  };

  it('starts a synchronous run and returns completed result', async () => {
    const agentRepo = new InMemoryAgentRepository();
    const runRepo = new InMemoryRunRepository();
    const queue = new InMemoryAgentQueue();
    const loopUseCase = new ExecuteRunLoopUseCase(runRepo, dummyInference, dummyTools);
    const startUseCase = new StartRunUseCase(agentRepo, runRepo, queue, loopUseCase);

    const result = await startUseCase.execute(
      {
        agentId: 'oicunt.agent.general',
        input: 'Test goal',
        mode: 'sync',
      },
      {
        tenantId: 'ten_01',
        userId: 'usr_01',
        actorId: 'actor_01',
        correlationId: 'corr_01',
      },
    );

    expect(result.status).toBe('completed');
    expect(result.finalOutput).toBe('Done.');
  });

  it('enqueues an asynchronous run and returns pending status', async () => {
    const agentRepo = new InMemoryAgentRepository();
    const runRepo = new InMemoryRunRepository();
    const queue = new InMemoryAgentQueue({ autoProcess: false });
    const loopUseCase = new ExecuteRunLoopUseCase(runRepo, dummyInference, dummyTools);
    const startUseCase = new StartRunUseCase(agentRepo, runRepo, queue, loopUseCase);

    const result = await startUseCase.execute(
      {
        agentId: 'oicunt.agent.general',
        input: 'Async goal',
        mode: 'async',
      },
      {
        tenantId: 'ten_01',
        userId: 'usr_01',
        actorId: 'actor_01',
        correlationId: 'corr_01',
      },
    );

    expect(result.status).toBe('pending');
    expect(queue.getPublishedJobs().length).toBe(1);
    expect(queue.getPublishedJobs()[0]!.runId).toBe(result.runId);
  });

  it('cancels an active run and rejects cancelling an already completed run', async () => {
    const agentRepo = new InMemoryAgentRepository();
    const runRepo = new InMemoryRunRepository();
    const queue = new InMemoryAgentQueue();
    const loopUseCase = new ExecuteRunLoopUseCase(runRepo, dummyInference, dummyTools);
    const startUseCase = new StartRunUseCase(agentRepo, runRepo, queue, loopUseCase);
    const cancelUseCase = new CancelRunUseCase(runRepo);

    // Run 1: completed
    const result = await startUseCase.execute(
      {
        agentId: 'oicunt.agent.general',
        input: 'Done goal',
        mode: 'sync',
      },
      {
        tenantId: 'ten_01',
        userId: 'usr_01',
        actorId: 'actor_01',
        correlationId: 'corr_01',
      },
    );

    // Cancelling completed run should throw InvalidRunStateError
    await expect(
      cancelUseCase.execute(result.runId as any, { reason: 'stop' }, { tenantId: 'ten_01' }),
    ).rejects.toThrow(/already in terminal status/);
  });

  it('gets run detail and ordered step history', async () => {
    const agentRepo = new InMemoryAgentRepository();
    const runRepo = new InMemoryRunRepository();
    const queue = new InMemoryAgentQueue();
    const loopUseCase = new ExecuteRunLoopUseCase(runRepo, dummyInference, dummyTools);
    const startUseCase = new StartRunUseCase(agentRepo, runRepo, queue, loopUseCase);
    const getRunUseCase = new GetRunUseCase(runRepo);
    const getStepsUseCase = new GetStepsUseCase(runRepo);

    const result = await startUseCase.execute(
      {
        agentId: 'oicunt.agent.general',
        input: 'Retrieve goal',
        mode: 'sync',
      },
      {
        tenantId: 'ten_01',
        userId: 'usr_01',
        actorId: 'actor_01',
        correlationId: 'corr_01',
      },
    );

    const detail = await getRunUseCase.execute(result.runId as any, { tenantId: 'ten_01' });
    expect(detail.runId).toBe(result.runId);
    expect(detail.status).toBe('completed');
    expect(detail.steps.length).toBe(1);

    const steps = await getStepsUseCase.execute(result.runId as any, { tenantId: 'ten_01' });
    expect(steps.length).toBe(1);
    expect(steps[0]!.stepNumber).toBe(1);
  });

  it('rejects resuming a completed run with InvalidRunStateError', async () => {
    const agentRepo = new InMemoryAgentRepository();
    const runRepo = new InMemoryRunRepository();
    const queue = new InMemoryAgentQueue();
    const loopUseCase = new ExecuteRunLoopUseCase(runRepo, dummyInference, dummyTools);
    const startUseCase = new StartRunUseCase(agentRepo, runRepo, queue, loopUseCase);
    const resumeUseCase = new ResumeRunUseCase(agentRepo, runRepo, loopUseCase);

    const result = await startUseCase.execute(
      {
        agentId: 'oicunt.agent.general',
        input: 'Test completed run',
        mode: 'sync',
      },
      {
        tenantId: 'ten_01',
        userId: 'usr_01',
        actorId: 'actor_01',
        correlationId: 'corr_01',
      },
    );

    await expect(
      resumeUseCase.execute(
        result.runId as any,
        { resumeType: 'confirmation', confirmationToken: 'token_123' },
        { tenantId: 'ten_01', actorId: 'actor_01' },
      ),
    ).rejects.toThrow(/Cannot resume run/);
  });
});
