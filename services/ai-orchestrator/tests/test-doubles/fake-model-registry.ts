import type {
  ModelResolutionQuery,
  ModelResolutionResult,
} from '../../src/application/dtos/resolution.dto.js';
import type { ModelRegistryPort } from '../../src/application/ports/model-registry.port.js';
import { ModelNotFoundError, UnsupportedEffortLevelError } from '../../src/domain/errors.js';

export class FakeModelRegistry implements ModelRegistryPort {
  public recordedQueries: ModelResolutionQuery[] = [];
  public isHealthy = true;
  public shouldFailWith: Error | null = null;
  private readonly models = new Map<string, ModelResolutionResult>();

  constructor() {
    this.seedDefaultModels();
  }

  public registerModel(result: ModelResolutionResult): void {
    this.models.set(result.canonicalModelId, result);
  }

  public async resolveModel(
    query: ModelResolutionQuery,
    _signal?: AbortSignal,
  ): Promise<ModelResolutionResult> {
    this.recordedQueries.push(query);

    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }

    const model = this.models.get(query.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(query.canonicalModelId, query.correlationId);
    }

    if (query.effort) {
      const supported = model.capabilities.supportedEffortLevels ?? [];
      if (!model.capabilities.reasoning || !supported.includes(query.effort)) {
        throw new UnsupportedEffortLevelError(
          query.canonicalModelId,
          query.effort,
          supported,
          query.correlationId,
        );
      }
    }

    return {
      ...model,
      effort: query.effort ?? model.capabilities.defaultEffortLevel,
    };
  }

  public async checkHealth(_signal?: AbortSignal): Promise<boolean> {
    return this.isHealthy;
  }

  private seedDefaultModels(): void {
    this.registerModel({
      canonicalModelId: 'claude-sonnet',
      version: 'v1.0.0',
      displayName: 'Claude Sonnet',
      description: 'Claude 3.5 Sonnet flagship reasoning model',
      family: 'claude',
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
        maxOutputTokens: 8192,
      },
      pricing: {
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
        costPerMillionCachedTokens: 0.3,
      },
      status: 'available',
      eligibleTargets: [
        {
          targetId: 'anthropic-sonnet-primary',
          provider: 'anthropic',
          upstreamModelId: 'claude-3-5-sonnet-20241022',
          priority: 1,
          weight: 100,
          supportsStreaming: true,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      resolvedAt: new Date().toISOString(),
    });

    this.registerModel({
      canonicalModelId: 'gpt-4o',
      version: 'v1.0.0',
      displayName: 'GPT-4o',
      description: 'OpenAI GPT-4o multimodal model',
      family: 'gpt',
      modalities: ['text', 'image'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: false,
        vision: true,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: {
        contextWindowTokens: 128_000,
        maxOutputTokens: 4096,
      },
      pricing: {
        costPerMillionInputTokens: 2.5,
        costPerMillionOutputTokens: 10.0,
      },
      status: 'available',
      eligibleTargets: [
        {
          targetId: 'openai-gpt4o-primary',
          provider: 'openai',
          upstreamModelId: 'gpt-4o',
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
      resolvedAt: new Date().toISOString(),
    });

    this.registerModel({
      canonicalModelId: 'model-maintenance',
      version: 'v1.0.0',
      displayName: 'Maintenance Model',
      description: 'Model under maintenance',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredOutputs: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: {
        contextWindowTokens: 32_000,
        maxOutputTokens: 2048,
      },
      pricing: {
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 2.0,
      },
      status: 'maintenance',
      eligibleTargets: [
        {
          targetId: 'target-maintenance',
          provider: 'anthropic',
          upstreamModelId: 'maintenance',
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
      resolvedAt: new Date().toISOString(),
    });

    this.registerModel({
      canonicalModelId: 'model-deprecated',
      version: 'v1.0.0',
      displayName: 'Deprecated Model',
      description: 'Retired model',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredOutputs: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: {
        contextWindowTokens: 8000,
        maxOutputTokens: 1024,
      },
      pricing: {
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 2.0,
      },
      status: 'deprecated',
      eligibleTargets: [],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 1,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      resolvedAt: new Date().toISOString(),
    });

    this.registerModel({
      canonicalModelId: 'model-no-targets',
      version: 'v1.0.0',
      displayName: 'No Targets Model',
      description: 'Model with zero targets',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredOutputs: false,
        reasoning: false,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: {
        contextWindowTokens: 32_000,
        maxOutputTokens: 2048,
      },
      pricing: {
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 2.0,
      },
      status: 'available',
      eligibleTargets: [],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 1,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      resolvedAt: new Date().toISOString(),
    });
  }
}
