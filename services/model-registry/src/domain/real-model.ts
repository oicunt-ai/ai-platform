import { CanonicalModel } from './canonical-model.js';
import { ModelVersion } from './model-version.js';
import { ModelTarget } from './model-target.js';
import { RoutingPolicy } from './routing-policy.js';
import { ModelAlias } from './model-alias.js';
import type { ModelRepositoryPort } from '../application/ports/model-repository.port.js';

/**
 * Real production model definition for Anthropic Claude 3.5 Sonnet.
 * Provides the authoritative Model Registry control-plane mapping from
 * canonical identifier 'claude-sonnet' to provider 'anthropic' and
 * upstream target 'claude-3-5-sonnet-20241022'.
 */
export function createRealModelDefinition(): CanonicalModel {
  const model = new CanonicalModel({
    id: 'claude-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    description: 'Anthropic Claude 3.5 Sonnet frontier intelligence model',
    family: 'claude',
    activeVersion: 'v1.0.0',
  });

  const v1 = new ModelVersion({
    id: 'ver-claude-sonnet-v1',
    canonicalModelId: 'claude-sonnet',
    version: 'v1.0.0',
    modalities: ['text', 'image'],
    capabilities: {
      streaming: false, // Step 3 scope: synchronous unary completion
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
      contextWindowTokens: 200000,
      maxOutputTokens: 8192,
    },
    pricing: {
      costPerMillionInputTokens: 3.0,
      costPerMillionOutputTokens: 15.0,
      costPerMillionCachedTokens: 0.3,
    },
    status: 'available',
  });

  const target = new ModelTarget({
    id: 'target-anthropic-claude-3-5-sonnet',
    modelVersionId: v1.id,
    provider: 'anthropic',
    upstreamModelId: 'claude-3-5-sonnet-20241022',
    priority: 1,
    weight: 100,
    supportsStreaming: false,
    status: 'available',
  });

  const routingPolicy = new RoutingPolicy({
    canonicalModelId: 'claude-sonnet',
    strategy: 'priority-fallback',
    maxFallbackAttempts: 2,
    requireHealthyTarget: true,
    degradationBehavior: 'fail-fast',
  });

  const alias = new ModelAlias({
    canonicalModelId: 'claude-sonnet',
    aliasName: 'latest',
    targetVersion: 'v1.0.0',
  });

  model.addVersion(v1);
  model.addTarget(target);
  model.updateRoutingPolicy(routingPolicy);
  model.setAlias(alias);

  return model;
}

/**
 * Registers the real model definition in the repository if not already present.
 */
export async function registerRealModel(repository: ModelRepositoryPort): Promise<CanonicalModel> {
  const existing = await repository.findById('claude-sonnet');
  if (existing) {
    return existing;
  }
  const realModel = createRealModelDefinition();
  await repository.save(realModel);
  return realModel;
}
