import { describe, expect, it } from 'vitest';
import type { MessageContentPart } from '@oicunt-ai/ai-types';
import { estimateContentTokens } from '../../src/domain/token-estimator.js';

describe('estimateContentTokens', () => {
  it('estimates tokens for empty and non-empty strings', () => {
    expect(estimateContentTokens('')).toBe(0);
    expect(estimateContentTokens('hi')).toBe(1);
    expect(estimateContentTokens('12345678')).toBe(2);
    expect(estimateContentTokens('123456789')).toBe(3);
  });

  it('estimates tokens for polymorphic message content parts', () => {
    const parts: MessageContentPart[] = [
      { type: 'text', text: 'Hello, how can I help you today?' },
      { type: 'image', mimeType: 'image/png', data: 'base64data...' },
      {
        type: 'tool_call',
        id: 'call_123',
        name: 'get_weather',
        arguments: { city: 'Tokyo', units: 'celsius' },
      },
      {
        type: 'tool_result',
        toolCallId: 'call_123',
        name: 'get_weather',
        content: { temperature: 22, condition: 'Sunny' },
      },
      { type: 'thinking', thinking: 'Let me think about this step by step...' },
    ];

    const estimate = estimateContentTokens(parts);
    expect(estimate).toBeGreaterThan(100); // Image (85) + text + tools + thinking
  });

  it('handles empty parts array', () => {
    expect(estimateContentTokens([])).toBe(0);
  });
});
