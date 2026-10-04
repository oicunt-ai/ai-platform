import { describe, it, expect } from 'vitest';
import { AgentExecutionError, type AgentConfig, type AgentRunResult } from './index.js';

describe('@oicunt-ai/agent-types', () => {
  it('instantiates AgentExecutionError with agentId and runId', () => {
    const error = new AgentExecutionError('Max steps exceeded', 'support-agent', 'run-999');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AgentExecutionError');
    expect(error.agentId).toBe('support-agent');
    expect(error.runId).toBe('run-999');
    expect(error.message).toBe('Max steps exceeded');
  });

  it('validates AgentConfig structure', () => {
    const config: AgentConfig = {
      id: 'analyst-agent',
      name: 'Data Analyst Agent',
      description: 'Analyzes structured business datasets',
      systemPrompt: 'You are an expert data analyst.',
      model: 'oicunt.model.reasoning',
      allowedTools: ['sql_query', 'chart_generator'],
      maxSteps: 10,
    };
    expect(config.id).toBe('analyst-agent');
    expect(config.model).toBe('oicunt.model.reasoning');
    expect(config.maxSteps).toBe(10);
  });

  it('validates AgentRunResult contract', () => {
    const result: AgentRunResult = {
      runId: 'run-001',
      agentId: 'analyst-agent',
      status: 'completed',
      steps: [
        {
          stepId: 'step-1',
          stepNumber: 1,
          type: 'thought',
          content: 'I need to check the revenue trend.',
          timestamp: '2026-10-04T12:00:00Z',
        },
      ],
      finalResponse: 'The revenue grew by 15% this quarter.',
      totalUsage: {
        promptTokens: 200,
        completionTokens: 80,
        totalTokens: 280,
      },
      durationMs: 1250,
    };
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(1);
    expect(result.totalUsage.totalTokens).toBe(280);
  });
});
