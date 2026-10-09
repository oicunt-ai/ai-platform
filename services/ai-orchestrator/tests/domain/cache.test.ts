import { describe, expect, it } from 'vitest';
import { InMemoryResolutionCache } from '../../src/infrastructure/cache/in-memory-resolution-cache.js';
import type { ModelResolutionResult } from '../../src/application/dtos/resolution.dto.js';

describe('Infrastructure - InMemoryResolutionCache', () => {
  const sampleResult: ModelResolutionResult = {
    canonicalModelId: 'oicunt.model.catalog-alpha',
    version: 'v1.0.0',
    displayName: 'Catalog Model Alpha',
    description: 'Alpha',
    modalities: ['text'],
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
    limits: { contextWindowTokens: 200_000, maxOutputTokens: 8192 },
    pricing: { costPerMillionInputTokens: 3, costPerMillionOutputTokens: 15 },
    status: 'available',
    eligibleTargets: [],
    routingPolicy: {
      strategy: 'priority-fallback',
      maxFallbackAttempts: 2,
      requireHealthyTarget: true,
      degradationBehavior: 'fail-fast',
    },
    resolvedAt: new Date().toISOString(),
  };

  it('stores and retrieves items correctly', () => {
    const cache = new InMemoryResolutionCache(60, 10);
    cache.set('key1', sampleResult);

    expect(cache.get('key1')).toEqual(sampleResult);
    expect(cache.size()).toBe(1);
  });

  it('expires entries after TTL', async () => {
    const cache = new InMemoryResolutionCache(1, 10); // 1 second TTL
    cache.set('key1', sampleResult, 0.05); // 50ms TTL

    expect(cache.get('key1')).toEqual(sampleResult);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(cache.get('key1')).toBeNull();
  });

  it('evicts least recently used items when capacity is reached', () => {
    const cache = new InMemoryResolutionCache(60, 2); // max 2 items

    cache.set('key1', { ...sampleResult, canonicalModelId: 'oicunt.model.m1' });
    cache.set('key2', { ...sampleResult, canonicalModelId: 'oicunt.model.m2' });

    // Access key1 so key2 becomes least recently used
    cache.get('key1');

    // Insert key3 -> should evict key2
    cache.set('key3', { ...sampleResult, canonicalModelId: 'oicunt.model.m3' });

    expect(cache.get('key1')?.canonicalModelId).toBe('oicunt.model.m1');
    expect(cache.get('key2')).toBeNull();
    expect(cache.get('key3')?.canonicalModelId).toBe('oicunt.model.m3');
  });

  it('deletes and clears entries', () => {
    const cache = new InMemoryResolutionCache(60, 10);
    cache.set('k1', sampleResult);
    cache.set('k2', sampleResult);

    cache.delete('k1');
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')).toEqual(sampleResult);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('k2')).toBeNull();
  });
});
