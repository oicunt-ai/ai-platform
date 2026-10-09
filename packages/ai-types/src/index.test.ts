import { describe, it, expect } from 'vitest';
import type { ChatMessage, NormalizedCompletionData, StreamEvent } from './index.js';

describe('@oicunt-ai/ai-types', () => {
  it('constructs a valid ChatMessage with string content', () => {
    const message: ChatMessage = {
      role: 'user',
      content: 'Hello, AI Platform!',
    };
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello, AI Platform!');
  });

  it('constructs a valid ChatMessage with multimodal parts', () => {
    const message: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image', mimeType: 'image/png', data: 'data:image/png;base64,...' },
      ],
    };
    expect(Array.isArray(message.content)).toBe(true);
    expect(message.content).toHaveLength(2);
  });

  it('constructs a valid NormalizedCompletionData payload', () => {
    const completion: NormalizedCompletionData = {
      completionId: 'cmp_12345',
      model: 'oicunt.model.catalog-alpha',
      message: {
        role: 'assistant',
        content: 'Processed successfully.',
      },
      finishReason: 'stop',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      latencyMs: 320,
    };
    expect(completion.finishReason).toBe('stop');
    expect(completion.usage.totalTokens).toBe(15);
  });

  it('handles discriminated stream events correctly', () => {
    const tokenEvent: StreamEvent = {
      event: 'token',
      data: { delta: 'Hello' },
    };
    expect(tokenEvent.event).toBe('token');
    expect(tokenEvent.data.delta).toBe('Hello');
  });
});
