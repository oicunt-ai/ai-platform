import { describe, it, expect } from 'vitest';
import { ModelDomainError, type ModelSpec, type TokenUsage } from './index.js';

describe('@oicunt-ai/model-types', () => {
  it('instantiates ModelDomainError with code and message', () => {
    const error = new ModelDomainError('MODEL_NOT_FOUND', 'Requested model does not exist');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ModelDomainError');
    expect(error.code).toBe('MODEL_NOT_FOUND');
    expect(error.message).toBe('Requested model does not exist');
  });

  it('validates TokenUsage structure correctly', () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      reasoningTokens: 20,
      cachedTokens: 10,
    };
    expect(usage.promptTokens + usage.completionTokens).toBe(usage.totalTokens);
  });

  it('type checks ModelSpec contract structure', () => {
    const spec: ModelSpec = {
      canonicalId: 'oicunt.model.general',
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet',
      displayName: 'General Intelligence',
      description: 'Standard general purpose model',
      modalities: ['text', 'image'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: true,
        vision: true,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: {
        contextWindowTokens: 200_000,
        maxOutputTokens: 8_192,
      },
      pricing: {
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
      },
      defaultTemperature: 0.7,
    };
    expect(spec.canonicalId).toBe('oicunt.model.general');
    expect(spec.capabilities.streaming).toBe(true);
  });
});
