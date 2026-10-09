import type {
  ModelRegistryPort,
  ModelResolutionQuery,
  ModelResolutionResult,
} from '../../application/ports/model-registry.port.js';
import type { ModelCapabilities } from '@oicunt-ai/model-types';
import { UnsupportedCapabilityError, UnsupportedModelError } from '../../domain/errors.js';

const defaultEmbeddingCapabilities: ModelCapabilities = {
  streaming: false,
  toolCalling: false,
  structuredOutputs: false,
  reasoning: false,
  vision: false,
  audioInput: false,
  audioOutput: false,
  systemInstructions: false,
};

const defaultChatCapabilities: ModelCapabilities = {
  streaming: true,
  toolCalling: true,
  structuredOutputs: true,
  reasoning: false,
  vision: true,
  audioInput: false,
  audioOutput: false,
  systemInstructions: true,
};

export class MockModelRegistryClient implements ModelRegistryPort {
  private readonly models = new Map<string, ModelResolutionResult>();
  public shouldFailHealth = false;

  constructor() {
    this.registerDefaultModels();
  }

  private registerDefaultModels(): void {
    const now = new Date().toISOString();

    this.models.set('oicunt.model.catalog-embedding', {
      canonicalModelId: 'oicunt.model.catalog-embedding',
      version: '1.0.0',
      displayName: 'OICUNT General Embedding',
      description: 'Default general-purpose dense vector embedding model',
      modalities: ['embedding'],
      status: 'available',
      resolvedAt: now,
      limits: {
        contextWindowTokens: 8192,
        maxOutputTokens: 1536,
      },
      capabilities: defaultEmbeddingCapabilities,
      metadata: {
        dimensions: 1536,
        maxItemCharacters: 32768,
      },
      eligibleTargets: [
        {
          targetId: 'tgt-openai-emb-1',
          provider: 'openai',
          upstreamModelId: 'text-embedding-3-small',
          priority: 1,
          weight: 100,
          supportsStreaming: false,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
    });

    this.models.set('oicunt.model.catalog-embedding.fast', {
      canonicalModelId: 'oicunt.model.catalog-embedding.fast',
      version: '1.0.0',
      displayName: 'OICUNT Fast Embedding',
      description: 'Low-latency high-throughput embedding model',
      modalities: ['embedding'],
      status: 'available',
      resolvedAt: now,
      limits: {
        contextWindowTokens: 4096,
        maxOutputTokens: 768,
      },
      capabilities: defaultEmbeddingCapabilities,
      metadata: {
        dimensions: 768,
        maxItemCharacters: 16384,
      },
      eligibleTargets: [
        {
          targetId: 'tgt-fast-emb-1',
          provider: 'local',
          upstreamModelId: 'bge-base-en-v1.5',
          priority: 1,
          weight: 100,
          supportsStreaming: false,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 1,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
    });

    this.models.set('oicunt.model.catalog-embedding.code', {
      canonicalModelId: 'oicunt.model.catalog-embedding.code',
      version: '1.0.0',
      displayName: 'OICUNT Code Embedding',
      description: 'Codebase and technical documentation embedding model',
      modalities: ['embedding'],
      status: 'available',
      resolvedAt: now,
      limits: {
        contextWindowTokens: 8192,
        maxOutputTokens: 1536,
      },
      capabilities: defaultEmbeddingCapabilities,
      metadata: {
        dimensions: 1536,
        maxItemCharacters: 32768,
      },
      eligibleTargets: [
        {
          targetId: 'tgt-code-emb-1',
          provider: 'openai',
          upstreamModelId: 'text-embedding-3-small',
          priority: 1,
          weight: 100,
          supportsStreaming: false,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 1,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
    });

    this.models.set('text-embedding-3-small', {
      canonicalModelId: 'text-embedding-3-small',
      version: '1.0.0',
      displayName: 'OpenAI text-embedding-3-small',
      description: 'Frontier small embedding model with variable dimensions',
      modalities: ['embedding'],
      status: 'available',
      resolvedAt: now,
      limits: {
        contextWindowTokens: 8192,
        maxOutputTokens: 1536,
      },
      capabilities: defaultEmbeddingCapabilities,
      metadata: {
        dimensions: 1536,
        supportedDimensions: [512, 1536],
        maxItemCharacters: 32768,
      },
      eligibleTargets: [
        {
          targetId: 'tgt-openai-small-1',
          provider: 'openai',
          upstreamModelId: 'text-embedding-3-small',
          priority: 1,
          weight: 100,
          supportsStreaming: false,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
    });

    this.models.set('text-embedding-3-large', {
      canonicalModelId: 'text-embedding-3-large',
      version: '1.0.0',
      displayName: 'OpenAI text-embedding-3-large',
      description: 'Frontier large embedding model with variable dimensions',
      modalities: ['embedding'],
      status: 'available',
      resolvedAt: now,
      limits: {
        contextWindowTokens: 8192,
        maxOutputTokens: 3072,
      },
      capabilities: defaultEmbeddingCapabilities,
      metadata: {
        dimensions: 3072,
        supportedDimensions: [256, 1024, 1536, 3072],
        maxItemCharacters: 32768,
      },
      eligibleTargets: [
        {
          targetId: 'tgt-openai-large-1',
          provider: 'openai',
          upstreamModelId: 'text-embedding-3-large',
          priority: 1,
          weight: 100,
          supportsStreaming: false,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
    });

    this.models.set('chat-model-gpt4', {
      canonicalModelId: 'chat-model-gpt4',
      version: '1.0.0',
      displayName: 'Catalog Model Beta Chat',
      description: 'Text completion and chat model (non-embedding)',
      modalities: ['text'],
      status: 'available',
      resolvedAt: now,
      limits: {
        contextWindowTokens: 128000,
        maxOutputTokens: 4096,
      },
      capabilities: defaultChatCapabilities,
      eligibleTargets: [
        {
          targetId: 'tgt-gpt4-1',
          provider: 'openai',
          upstreamModelId: 'provider-model-beta',
          priority: 1,
          weight: 100,
          supportsStreaming: true,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 1,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
    });
  }

  public registerModel(model: ModelResolutionResult): void {
    this.models.set(model.canonicalModelId, model);
  }

  public async resolveModel(
    query: ModelResolutionQuery,
    _signal?: AbortSignal,
  ): Promise<ModelResolutionResult> {
    const model = this.models.get(query.canonicalModelId);
    if (!model) {
      throw new UnsupportedModelError(query.canonicalModelId);
    }
    if (!model.modalities.includes('embedding')) {
      throw new UnsupportedCapabilityError(query.canonicalModelId, 'embedding');
    }
    return model;
  }

  public async checkHealth(_signal?: AbortSignal): Promise<boolean> {
    return !this.shouldFailHealth;
  }
}
