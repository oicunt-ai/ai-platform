import { describe, expect, it } from 'vitest';
import type { AgentRun, AgentVersion } from '../../src/domain/entities.js';
import type {
  AgentInferenceRequest,
  AgentInferenceResponse,
  InferenceClientPort,
} from '../../src/application/ports/inference-client.port.js';
import type {
  AgentToolExecutionOutcome,
  AgentToolExecutionRequest,
  ToolsClientPort,
} from '../../src/application/ports/tools-client.port.js';
import { InMemoryRunRepository } from '../../src/infrastructure/repositories/in-memory-run.repository.js';
import { ExecuteRunLoopUseCase } from '../../src/application/use-cases/execute-run-loop.use-case.js';
import { BUILT_IN_AGENTS } from '../../src/domain/built-in-agents.js';

class MockInferenceClient implements InferenceClientPort {
  private responses: AgentInferenceResponse[] = [];
  public callCount = 0;

  public enqueueResponse(response: AgentInferenceResponse): void {
    this.responses.push(response);
  }

  public async execute(
    _request: AgentInferenceRequest,
    _signal?: AbortSignal,
  ): Promise<AgentInferenceResponse> {
    this.callCount++;
    const resp = this.responses.shift();
    if (!resp) {
      throw new Error('No mock inference response available');
    }
    return resp;
  }
}

class MockToolsClient implements ToolsClientPort {
  private outcomes: AgentToolExecutionOutcome[] = [];
  public callHistory: AgentToolExecutionRequest[] = [];

  public enqueueOutcome(outcome: AgentToolExecutionOutcome): void {
    this.outcomes.push(outcome);
  }

  public async executeTool(
    request: AgentToolExecutionRequest,
    _signal?: AbortSignal,
  ): Promise<AgentToolExecutionOutcome> {
    this.callHistory.push(request);
    const outcome = this.outcomes.shift();
    if (!outcome) {
      throw new Error('No mock tool outcome available');
    }
    return outcome;
  }
}

describe('ExecuteRunLoopUseCase', () => {
  const version: AgentVersion = BUILT_IN_AGENTS[0]!.version;

  const baseRun: AgentRun = {
    runId: 'run_test_01',
    agentId: 'oicunt.agent.general',
    agentVersion: '1.0.0',
    tenantId: 'ten_test',
    actorId: 'usr_test',
    correlationId: 'corr_test',
    status: 'running',
    budget: {
      maxSteps: 5,
      deadlineMs: Date.now() + 60_000,
      maxModelCalls: 10,
      maxToolCalls: 10,
      maxConsecutiveErrors: 2,
    },
    cumulativeUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    currentStepNumber: 0,
    startedAt: new Date().toISOString(),
  };

  it('completes successfully when model returns terminal response without tool calls', async () => {
    const runRepo = new InMemoryRunRepository();
    const inferenceClient = new MockInferenceClient();
    const toolsClient = new MockToolsClient();

    await runRepo.createRun(baseRun);

    inferenceClient.enqueueResponse({
      completionId: 'comp_1',
      message: {
        role: 'assistant',
        content: 'Analysis complete. The result is 42.',
      },
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const useCase = new ExecuteRunLoopUseCase(runRepo, inferenceClient, toolsClient);
    const result = await useCase.execute(baseRun, version, 'Solve the question');

    expect(result.status).toBe('completed');
    expect(result.terminationReason).toBe('goal_achieved');
    expect(result.finalOutput).toBe('Analysis complete. The result is 42.');
    expect(result.totalSteps).toBe(1);

    const steps = await runRepo.getSteps(baseRun.runId);
    expect(steps.length).toBe(1);
    expect(steps[0]!.type).toBe('response');
    expect(steps[0]!.status).toBe('completed');
  });

  it('executes tool action and continues loop until completion', async () => {
    const runRepo = new InMemoryRunRepository();
    const inferenceClient = new MockInferenceClient();
    const toolsClient = new MockToolsClient();

    await runRepo.createRun(baseRun);

    // Turn 1: model calls tool
    inferenceClient.enqueueResponse({
      completionId: 'comp_1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_calc_01',
              name: 'oicunt.tool.calculator',
              arguments: { expression: '21 * 2' },
            },
          },
        ] as any,
      },
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
    });

    // Tool result
    toolsClient.enqueueOutcome({
      status: 'success',
      output: { result: 42 },
      durationMs: 15,
    });

    // Turn 2: model provides terminal answer
    inferenceClient.enqueueResponse({
      completionId: 'comp_2',
      message: {
        role: 'assistant',
        content: 'The computed answer is 42.',
      },
      finishReason: 'stop',
      usage: { promptTokens: 150, completionTokens: 15, totalTokens: 165 },
    });

    const useCase = new ExecuteRunLoopUseCase(runRepo, inferenceClient, toolsClient);
    const result = await useCase.execute(baseRun, version, 'Calculate 21 * 2');

    expect(result.status).toBe('completed');
    expect(result.finalOutput).toBe('The computed answer is 42.');
    expect(toolsClient.callHistory.length).toBe(1);
    expect(toolsClient.callHistory[0]!.callId).toBe('call_calc_01');

    const steps = await runRepo.getSteps(baseRun.runId);
    expect(steps.length).toBe(2);
    expect(steps[0]!.action?.name).toBe('oicunt.tool.calculator');
    expect(steps[0]!.observation?.isSuccess).toBe(true);
    expect(steps[1]!.type).toBe('response');
  });

  it('suspends execution when tool requires confirmation', async () => {
    const runRepo = new InMemoryRunRepository();
    const inferenceClient = new MockInferenceClient();
    const toolsClient = new MockToolsClient();

    await runRepo.createRun(baseRun);

    // Turn 1: model calls side-effecting tool
    inferenceClient.enqueueResponse({
      completionId: 'comp_1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_delete_01',
              name: 'oicunt.tool.delete_records',
              arguments: { table: 'customers' },
            },
          },
        ] as any,
      },
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
    });

    // Tool requires confirmation
    toolsClient.enqueueOutcome({
      status: 'confirmation_required',
      challenge: {
        confirmationId: 'conf_123',
        challengeToken: 'token_ed25519_abc',
        toolId: 'oicunt.tool.delete_records',
        callId: 'call_delete_01',
        arguments: { table: 'customers' },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });

    const useCase = new ExecuteRunLoopUseCase(runRepo, inferenceClient, toolsClient);
    const result = await useCase.execute(baseRun, version, 'Delete customers');

    expect(result.status).toBe('waiting_for_confirmation');
    expect(result.pendingChallenge?.type).toBe('confirmation');
    if (result.pendingChallenge?.type === 'confirmation') {
      expect(result.pendingChallenge.challenge.challengeToken).toBe('token_ed25519_abc');
    }

    const updatedRun = await runRepo.getRun(baseRun.tenantId, baseRun.runId);
    expect(updatedRun?.status).toBe('waiting_for_confirmation');

    const checkpoint = await runRepo.getLatestCheckpoint(baseRun.runId);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.pendingChallenge?.type).toBe('confirmation');
  });

  it('halts when maxSteps budget is exceeded', async () => {
    const runRepo = new InMemoryRunRepository();
    const inferenceClient = new MockInferenceClient();
    const toolsClient = new MockToolsClient();

    const shortBudgetRun: AgentRun = {
      ...baseRun,
      budget: { ...baseRun.budget, maxSteps: 2 },
    };
    await runRepo.createRun(shortBudgetRun);

    // Step 1: tool call
    inferenceClient.enqueueResponse({
      completionId: 'comp_1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_1', name: 'oicunt.tool.calculator', arguments: {} },
          },
        ] as any,
      },
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });
    toolsClient.enqueueOutcome({ status: 'success', output: {}, durationMs: 10 });

    // Step 2: another tool call
    inferenceClient.enqueueResponse({
      completionId: 'comp_2',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_2', name: 'oicunt.tool.calculator', arguments: {} },
          },
        ] as any,
      },
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });
    toolsClient.enqueueOutcome({ status: 'success', output: {}, durationMs: 10 });

    const useCase = new ExecuteRunLoopUseCase(runRepo, inferenceClient, toolsClient);
    const result = await useCase.execute(shortBudgetRun, version, 'Loop forever');

    expect(result.status).toBe('failed');
    expect(result.terminationReason).toBe('max_steps_exceeded');
  });

  it('halts when consecutive error limit is exceeded', async () => {
    const runRepo = new InMemoryRunRepository();
    const inferenceClient = new MockInferenceClient();
    const toolsClient = new MockToolsClient();

    const runWithErrorLimit: AgentRun = {
      ...baseRun,
      budget: { ...baseRun.budget, maxConsecutiveErrors: 2 },
    };
    await runRepo.createRun(runWithErrorLimit);

    // Step 1: tool call fails
    inferenceClient.enqueueResponse({
      completionId: 'comp_1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_1', name: 'oicunt.tool.calculator', arguments: {} },
          },
        ] as any,
      },
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });
    toolsClient.enqueueOutcome({
      status: 'failure',
      error: { code: 'FAIL', message: 'First failure', retryable: false },
      durationMs: 10,
    });

    // Step 2: tool call fails again
    inferenceClient.enqueueResponse({
      completionId: 'comp_2',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_2', name: 'oicunt.tool.calculator', arguments: {} },
          },
        ] as any,
      },
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });
    toolsClient.enqueueOutcome({
      status: 'failure',
      error: { code: 'FAIL', message: 'Second failure', retryable: false },
      durationMs: 10,
    });

    const useCase = new ExecuteRunLoopUseCase(runRepo, inferenceClient, toolsClient);
    const result = await useCase.execute(runWithErrorLimit, version, 'Fail repeatedly');

    expect(result.status).toBe('failed');
    expect(result.terminationReason).toBe('consecutive_errors_exceeded');
  });
});
