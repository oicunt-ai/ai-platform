/**
 * Canonical OICUNT AI Platform model identifiers.
 * Public and internal service-to-service requests must use canonical identifiers,
 * never raw upstream vendor model names.
 */
export type CanonicalModelId =
  | 'oicunt.model.general'
  | 'oicunt.model.general.fast'
  | 'oicunt.model.reasoning'
  | 'oicunt.model.coding'
  | 'oicunt.model.embedding'
  | 'oicunt.model.vision'
  | (string & {});

/**
 * Upstream model provider categories.
 */
export type ModelProviderType =
  'anthropic' | 'openai' | 'google' | 'bedrock' | 'azure-openai' | 'local' | 'custom';

/**
 * Supported model modalities.
 */
export type ModelModality = 'text' | 'image' | 'audio' | 'video' | 'embedding';

/**
 * Feature capabilities supported by an AI model.
 */
export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly structuredOutputs: boolean;
  readonly reasoning: boolean;
  readonly vision: boolean;
  readonly audioInput: boolean;
  readonly audioOutput: boolean;
  readonly systemInstructions: boolean;
}

/**
 * Operating context limits for a model.
 */
export interface ModelLimits {
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

/**
 * Pricing structure per 1M tokens (USD).
 */
export interface ModelPricing {
  readonly costPerMillionInputTokens: number;
  readonly costPerMillionOutputTokens: number;
  readonly costPerMillionCachedTokens?: number;
}

/**
 * Full canonical model specification registered in the platform.
 */
export interface ModelSpec {
  readonly canonicalId: CanonicalModelId;
  readonly provider: ModelProviderType;
  readonly upstreamModelId: string;
  readonly displayName: string;
  readonly description: string;
  readonly modalities: readonly ModelModality[];
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly defaultTemperature?: number;
}

/**
 * Token usage telemetry reported after model inference.
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
  readonly cachedTokens?: number;
}

/**
 * Hyperparameters and invocation options for model execution.
 */
export interface ModelInvocationParameters {
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly maxTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly seed?: number;
}

/**
 * Domain error for model catalog or invocation boundaries.
 */
export class ModelDomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelDomainError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
