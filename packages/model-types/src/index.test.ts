import { describe, it, expect } from 'vitest';
import { ModelDomainError, type ModelCatalogEntry, type TokenUsage } from './index.js';

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

  it('type checks ModelCatalogEntry contract structure', () => {
    const entry: ModelCatalogEntry = {
      id: 'oicunt.model.catalog-alpha',
      displayName: 'Catalog Model Alpha',
      description: 'Frontier reasoning and coding model',
      family: 'catalog-alpha',
      activeVersion: 'v1.0.0',
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
        supportedEffortLevels: ['low', 'medium', 'high'],
        defaultEffortLevel: 'medium',
      },
      limits: {
        contextWindowTokens: 200_000,
        maxOutputTokens: 8_192,
      },
      pricing: {
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
      },
      status: 'available',
      isSelectable: true,
    };
    expect(entry.id).toBe('oicunt.model.catalog-alpha');
    expect(entry.capabilities.reasoning).toBe(true);
    expect(entry.capabilities.defaultEffortLevel).toBe('medium');
    expect(entry.isSelectable).toBe(true);
  });
});
