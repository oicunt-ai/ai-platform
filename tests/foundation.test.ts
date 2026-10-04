import { describe, it, expect } from 'vitest';
import { ModelDomainError } from '@oicunt-ai/model-types';
import type { ChatMessage, NormalizedCompletionData } from '@oicunt-ai/ai-types';
import { ToolExecutionError } from '@oicunt-ai/tool-types';
import { AgentExecutionError } from '@oicunt-ai/agent-types';
import { MCP_LATEST_PROTOCOL_VERSION } from '@oicunt-ai/mcp-types';
import { NoopAiSpan, NoopAiTracer } from '@oicunt-ai/observability';

describe('AI Platform Foundation Integration', () => {
  it('exposes all shared package contracts consistently', () => {
    // Model Types
    const modelError = new ModelDomainError('UNSUPPORTED_MODALITY', 'Video not supported');
    expect(modelError.code).toBe('UNSUPPORTED_MODALITY');

    // AI Types
    const chatMsg: ChatMessage = {
      role: 'assistant',
      content: 'System ready',
    };
    const completion: NormalizedCompletionData = {
      completionId: 'test-1',
      model: 'oicunt.model.general',
      message: chatMsg,
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      latencyMs: 120,
    };
    expect(completion.finishReason).toBe('stop');

    // Tool Types
    const toolError = new ToolExecutionError('Timeout', 'bash', 'c-1');
    expect(toolError.toolName).toBe('bash');

    // Agent Types
    const agentError = new AgentExecutionError('Halted', 'agent-1');
    expect(agentError.agentId).toBe('agent-1');

    // MCP Types
    expect(MCP_LATEST_PROTOCOL_VERSION).toBe('2024-11-05');

    // Observability
    const tracer = new NoopAiTracer();
    const span = tracer.startSpan('test');
    expect(span).toBeInstanceOf(NoopAiSpan);
  });
});
