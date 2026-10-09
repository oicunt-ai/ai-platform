import { describe, it, expect, vi } from 'vitest';
import { JsonLogger } from '../../src/infrastructure/logging/logger.js';

describe('Privacy-Preserving Logging Verification', () => {
  it('strictly scrubs raw input texts and floating-point vector arrays from logs', () => {
    let capturedStdout = '';
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        capturedStdout += chunk.toString();
        return true;
      });

    const logger = new JsonLogger('embeddings-test', 'info');

    const rawInputText = 'SECRET_USER_PROMPT_THAT_MUST_NEVER_BE_LOGGED';
    const mockVector = [0.12345, -0.6789, 0.99999];
    const sensitiveApiKey = 'sk-prod-super-secret-key-12345';

    logger.info('Embeddings generated successfully', {
      tenantId: 'tenant-test-99',
      model: 'oicunt.model.catalog-embedding',
      modelVersion: '1.0.0',
      batchSize: 1,
      totalCharacters: rawInputText.length,
      promptTokens: 12,
      dimensions: 1536,
      latencyMs: 34,
      requestId: 'req-clean-123',
      correlationId: 'corr-clean-456',
      // The following forbidden keys must be stripped by the logger!
      inputs: [rawInputText],
      text: rawInputText,
      vectors: [mockVector],
      vector: mockVector,
      embeddings: [{ index: 0, vector: mockVector }],
      authorization: sensitiveApiKey,
      api_key: sensitiveApiKey,
      token: sensitiveApiKey,
    });

    stdoutSpy.mockRestore();

    expect(capturedStdout).not.toContain(rawInputText);
    expect(capturedStdout).not.toContain('0.12345');
    expect(capturedStdout).not.toContain('-0.6789');
    expect(capturedStdout).not.toContain(sensitiveApiKey);

    // Verify allowed metadata fields are preserved
    const parsed = JSON.parse(capturedStdout.trim()) as Record<string, unknown>;
    expect(parsed['tenantId']).toBe('tenant-test-99');
    expect(parsed['model']).toBe('oicunt.model.catalog-embedding');
    expect(parsed['modelVersion']).toBe('1.0.0');
    expect(parsed['batchSize']).toBe(1);
    expect(parsed['totalCharacters']).toBe(rawInputText.length);
    expect(parsed['promptTokens']).toBe(12);
    expect(parsed['dimensions']).toBe(1536);
    expect(parsed['latencyMs']).toBe(34);
    expect(parsed['requestId']).toBe('req-clean-123');
    expect(parsed['correlationId']).toBe('corr-clean-456');

    // Verify forbidden keys were dropped
    expect(parsed['inputs']).toBeUndefined();
    expect(parsed['text']).toBeUndefined();
    expect(parsed['vectors']).toBeUndefined();
    expect(parsed['vector']).toBeUndefined();
    expect(parsed['embeddings']).toBeUndefined();
    expect(parsed['authorization']).toBeUndefined();
    expect(parsed['api_key']).toBeUndefined();
  });
});
