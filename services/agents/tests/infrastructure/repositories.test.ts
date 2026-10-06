import { describe, expect, it } from 'vitest';
import { InMemoryAgentRepository } from '../../src/infrastructure/repositories/in-memory-agent.repository.js';
import { InMemoryRunRepository } from '../../src/infrastructure/repositories/in-memory-run.repository.js';
import type { AgentRun, AgentStep } from '../../src/domain/entities.js';

describe('In-Memory Repositories', () => {
  it('stores and retrieves agents and versions', async () => {
    const repo = new InMemoryAgentRepository(true);
    const agent = await repo.getAgent('oicunt.agent.general');
    expect(agent).not.toBeNull();
    expect(agent?.name).toBe('General Assistant Agent');

    const version = await repo.getAgentVersion('oicunt.agent.general', '1.0.0');
    expect(version).not.toBeNull();
    expect(version?.allowedTools).toContain('*');
  });

  it('manages runs, steps, checkpoints, and worker leases', async () => {
    const repo = new InMemoryRunRepository();

    const run: AgentRun = {
      runId: 'run_repo_01',
      agentId: 'oicunt.agent.general',
      agentVersion: '1.0.0',
      tenantId: 'ten_repo',
      actorId: 'usr_repo',
      correlationId: 'corr_repo',
      status: 'pending',
      budget: {
        maxSteps: 10,
        deadlineMs: Date.now() + 60_000,
        maxModelCalls: 10,
        maxToolCalls: 10,
        maxConsecutiveErrors: 2,
      },
      cumulativeUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      currentStepNumber: 0,
      startedAt: new Date().toISOString(),
    };

    await repo.createRun(run);
    const fetched = await repo.getRun('ten_repo', 'run_repo_01');
    expect(fetched?.status).toBe('pending');

    // Lease management
    const acquired = await repo.acquireLease('run_repo_01', 'worker_A', 10_000);
    expect(acquired).toBe(true);

    // Another worker cannot acquire active lease
    const acquiredB = await repo.acquireLease('run_repo_01', 'worker_B', 10_000);
    expect(acquiredB).toBe(false);

    // Same worker can renew
    const renewed = await repo.renewLease('run_repo_01', 'worker_A', 15_000);
    expect(renewed).toBe(true);

    // Release lease
    await repo.releaseLease('run_repo_01', 'worker_A');

    // Steps
    const step: AgentStep = {
      stepId: 'step_repo_01',
      runId: 'run_repo_01',
      stepNumber: 1,
      type: 'action',
      status: 'completed',
      decisionSummary: 'Called calculator',
      durationMs: 50,
      startedAt: new Date().toISOString(),
    };
    await repo.appendStep(step);

    const steps = await repo.getSteps('run_repo_01');
    expect(steps.length).toBe(1);
    expect(steps[0]!.stepNumber).toBe(1);

    // Checkpoints
    await repo.saveCheckpoint({
      checkpointId: 'cp_01',
      runId: 'run_repo_01',
      stepNumber: 1,
      statePayload: {
        scratchpad: [],
        goalInput: 'hello',
        decisionSummaries: [],
        cumulativeUsage: run.cumulativeUsage,
      },
      createdAt: new Date().toISOString(),
    });

    const cp = await repo.getLatestCheckpoint('run_repo_01');
    expect(cp?.stepNumber).toBe(1);
  });
});
