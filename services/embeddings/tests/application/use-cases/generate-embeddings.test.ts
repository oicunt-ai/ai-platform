import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateEmbeddingsUseCase } from '../../../src/application/use-cases/generate-embeddings.use-case.js';
import { MockModelRegistryClient } from '../../../src/infrastructure/clients/mock-model-registry.client.js';
import { MockModelGatewayClient } from '../../../src/infrastructure/clients/mock-model-gateway.client.js';
import {
  DeadlineExceededError,
  EmptyInputError,
  EmptyInputItemError,
  ModelUnavailableError,
  ProviderExecutionFailedError,
  RequestCancelledError,
  UnsupportedCapabilityError,
  UnsupportedModelError,
} from '../../../src/domain/errors.js';

describe('GenerateEmbeddingsUseCase', () => {
  let modelRegistry: MockModelRegistryClient;
  let modelGateway: MockModelGatewayClient;
  let useCase: GenerateEmbeddingsUseCase;

  beforeEach(() => {
    modelRegistry = new MockModelRegistryClient();
    modelGateway = new MockModelGatewayClient();
    useCase = new GenerateEmbeddingsUseCase(modelRegistry, modelGateway, {
      maxBatchSize: 256,
      maxItemCharacters: 32768,
      defaultTimeoutMs: 30000,
    });
  });

  it('successfully generates embeddings with positional determinism', async () => {
    const inputs = ['first text document', 'second text document', 'third text document'];
    const result = await useCase.execute(
      {
        model: 'oicunt.model.catalog-embedding',
        inputs,
      },
      {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-001',
        correlationId: 'corr-001',
      },
    );

    expect(result.model).toBe('oicunt.model.catalog-embedding');
    expect(result.modelVersion).toBe('1.0.0');
    expect(result.dimensions).toBe(1536);
    expect(result.embeddings).toHaveLength(3);

    // Positional determinism check: index strictly matches input positions
    expect(result.embeddings[0]?.index).toBe(0);
    expect(result.embeddings[0]?.vector).toHaveLength(1536);
    expect(result.embeddings[1]?.index).toBe(1);
    expect(result.embeddings[1]?.vector).toHaveLength(1536);
    expect(result.embeddings[2]?.index).toBe(2);
    expect(result.embeddings[2]?.vector).toHaveLength(1536);

    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it('supports custom dimensions for models with variable dimension capability', async () => {
    const inputs = ['testing variable dimensions'];
    const result = await useCase.execute(
      {
        model: 'text-embedding-3-small',
        inputs,
        dimensions: 512,
      },
      {
        tenantId: 'tenant-123',
        requestId: 'req-002',
        correlationId: 'corr-002',
      },
    );

    expect(result.dimensions).toBe(512);
    expect(result.embeddings[0]?.vector).toHaveLength(512);
  });

  it('rejects empty input list immediately', async () => {
    await expect(
      useCase.execute(
        {
          model: 'oicunt.model.catalog-embedding',
          inputs: [],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-003',
          correlationId: 'corr-003',
        },
      ),
    ).rejects.toThrow(EmptyInputError);
  });

  it('rejects empty input item with EmptyInputItemError', async () => {
    await expect(
      useCase.execute(
        {
          model: 'oicunt.model.catalog-embedding',
          inputs: ['valid item', '   '],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-004',
          correlationId: 'corr-004',
        },
      ),
    ).rejects.toThrow(EmptyInputItemError);
  });

  it('rejects unsupported model with UnsupportedModelError', async () => {
    await expect(
      useCase.execute(
        {
          model: 'unregistered.custom.model',
          inputs: ['sample text'],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-005',
          correlationId: 'corr-005',
        },
      ),
    ).rejects.toThrow(UnsupportedModelError);
  });

  it('rejects model without embedding modality with UnsupportedCapabilityError', async () => {
    await expect(
      useCase.execute(
        {
          model: 'chat-model-gpt4',
          inputs: ['sample text'],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-006',
          correlationId: 'corr-006',
        },
      ),
    ).rejects.toThrow(UnsupportedCapabilityError);
  });

  it('rejects model with maintenance status with ModelUnavailableError', async () => {
    modelRegistry.registerModel({
      canonicalModelId: 'maint-model',
      version: '1.0.0',
      displayName: 'Maintenance Model',
      description: 'Model in maintenance',
      modalities: ['embedding'],
      status: 'maintenance',
      resolvedAt: new Date().toISOString(),
      limits: { contextWindowTokens: 8192, maxOutputTokens: 1536 },
      capabilities: {
        streaming: false,
        toolCalling: false,
        structuredOutputs: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: false,
      },
      eligibleTargets: [],
    });

    await expect(
      useCase.execute(
        {
          model: 'maint-model',
          inputs: ['sample text'],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-007',
          correlationId: 'corr-007',
        },
      ),
    ).rejects.toThrow(ModelUnavailableError);
  });

  it('honors expired monotonic deadline with DeadlineExceededError', async () => {
    const expiredTime = Date.now() - 1000;
    await expect(
      useCase.execute(
        {
          model: 'oicunt.model.catalog-embedding',
          inputs: ['sample text'],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-008',
          correlationId: 'corr-008',
          deadlineMs: expiredTime,
        },
      ),
    ).rejects.toThrow(DeadlineExceededError);
  });

  it('honors AbortSignal cancellation with RequestCancelledError', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      useCase.execute(
        {
          model: 'oicunt.model.catalog-embedding',
          inputs: ['sample text'],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-009',
          correlationId: 'corr-009',
          signal: controller.signal,
        },
        controller.signal,
      ),
    ).rejects.toThrow(RequestCancelledError);
  });

  it('detects and rejects dimension mismatch returned by downstream provider', async () => {
    modelGateway.options = { overrideDimensions: 512 }; // Returns 512 instead of 1536

    await expect(
      useCase.execute(
        {
          model: 'oicunt.model.catalog-embedding',
          inputs: ['sample text'],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-010',
          correlationId: 'corr-010',
        },
      ),
    ).rejects.toThrow(ProviderExecutionFailedError);
  });

  it('detects and rejects vector count mismatch returned by downstream provider', async () => {
    modelGateway.options = { overrideVectorCount: 1 }; // Returns 1 vector for 2 inputs

    await expect(
      useCase.execute(
        {
          model: 'oicunt.model.catalog-embedding',
          inputs: ['first input', 'second input'],
        },
        {
          tenantId: 'tenant-123',
          requestId: 'req-011',
          correlationId: 'corr-011',
        },
      ),
    ).rejects.toThrow(ProviderExecutionFailedError);
  });
});
