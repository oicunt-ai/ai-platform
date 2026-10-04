import { describe, it, expect } from 'vitest';
import {
  EntityNotFoundError,
  ModelNotFoundError,
  ValidationError,
  InMemoryKeyValueStore,
  ok,
  err,
  loadAiServiceConfig,
} from '../../src/index.js';

describe('AI Service Template Unit Tests', () => {
  it('loads default config and applies overrides', () => {
    const config = loadAiServiceConfig({
      serviceName: 'test-ai-service',
      port: 8080,
    });
    expect(config.serviceName).toBe('test-ai-service');
    expect(config.port).toBe(8080);
  });

  it('instantiates domain errors correctly', () => {
    const modelErr = new ModelNotFoundError('oicunt.model.custom');
    expect(modelErr.code).toBe('MODEL_NOT_FOUND');
    expect(modelErr.message).toContain('oicunt.model.custom');

    const entityErr = new EntityNotFoundError('AgentRun', 'run-1');
    expect(entityErr.code).toBe('ENTITY_NOT_FOUND');

    const valErr = new ValidationError('Invalid prompt length', 'prompt');
    expect(valErr.code).toBe('VALIDATION_FAILED');
    expect(valErr.field).toBe('prompt');
  });

  it('stores and retrieves data via in-memory adapter', async () => {
    const store = new InMemoryKeyValueStore<string>();
    await store.set('key-1', 'val-1');
    expect(await store.get('key-1')).toBe('val-1');
    expect(await store.get('non-existent')).toBeNull();
    expect(await store.delete('key-1')).toBe(true);
    expect(await store.get('key-1')).toBeNull();
  });

  it('produces expected result objects with ok and err', () => {
    const successResult = ok({ tokens: 100 });
    expect(successResult.success).toBe(true);
    if (successResult.success) {
      expect(successResult.data.tokens).toBe(100);
    }

    const failureResult = err(new ValidationError('Empty messages'));
    expect(failureResult.success).toBe(false);
    if (!failureResult.success) {
      expect(failureResult.error.code).toBe('VALIDATION_FAILED');
    }
  });
});
