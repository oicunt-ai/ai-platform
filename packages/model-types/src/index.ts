/**
 * Canonical OICUNT AI Platform model identifiers.
 * Represents stable, OICUNT-owned model identities surfaced to users in BILLY
 * and consuming services (e.g. 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro').
 * Public and internal service-to-service requests must use canonical identifiers,
 * never raw upstream vendor model names.
 */
export type CanonicalModelId =
  | 'claude-sonnet'
  | 'claude-opus'
  | 'claude-haiku'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gemini-pro'
  | 'gemini-flash'
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
 * Supported reasoning effort levels for models with reasoning/thinking capabilities.
 */
export type ReasoningEffortLevel = 'low' | 'medium' | 'high' | (string & {});

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
  readonly supportedEffortLevels?: readonly ReasoningEffortLevel[] | undefined;
  readonly defaultEffortLevel?: ReasoningEffortLevel | undefined;
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
  readonly costPerMillionCachedTokens?: number | undefined;
}

/**
 * User-facing model catalog item exposed to BILLY and client selectors.
 * Contains metadata and capabilities necessary for model and effort selection,
 * without exposing internal provider-specific identifiers.
 */
export interface ModelCatalogEntry {
  readonly id: CanonicalModelId;
  readonly displayName: string;
  readonly description: string;
  readonly family?: string | undefined;
  readonly activeVersion: string;
  readonly modalities: readonly ModelModality[];
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly status: 'available' | 'degraded' | 'maintenance' | 'deprecated';
  readonly isSelectable: boolean;
}

/**
 * Token usage telemetry reported after model inference.
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number | undefined;
  readonly cachedTokens?: number | undefined;
}

/**
 * Hyperparameters and invocation options for model execution.
 */
export interface ModelInvocationParameters {
  readonly temperature?: number | undefined;
  readonly topP?: number | undefined;
  readonly topK?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly stopSequences?: readonly string[] | undefined;
  readonly presencePenalty?: number | undefined;
  readonly frequencyPenalty?: number | undefined;
  readonly seed?: number | undefined;
  readonly effort?: ReasoningEffortLevel | undefined;
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
