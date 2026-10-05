import { randomUUID } from 'node:crypto';
import type {
  CanonicalModelId,
  ModelCapabilities,
  ModelLimits,
  ModelModality,
  ModelPricing,
} from '@oicunt-ai/model-types';
import type { AvailabilityStatus, ModelVersionData } from './types.js';
import { ImmutableVersionViolationError, ModelValidationError } from './errors.js';

export interface CreateModelVersionParams {
  readonly id?: string | undefined;
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly modalities: readonly ModelModality[];
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly status?: AvailabilityStatus | undefined;
  readonly isImmutable?: boolean | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

const SEMVER_REGEX = /^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

export class ModelVersion {
  public readonly id: string;
  public readonly canonicalModelId: CanonicalModelId;
  public readonly version: string;
  private _modalities: readonly ModelModality[];
  private _capabilities: ModelCapabilities;
  private _limits: ModelLimits;
  private _pricing: ModelPricing;
  private _status: AvailabilityStatus;
  private _isImmutable: boolean;
  public readonly createdAt: string;
  private _updatedAt: string;

  constructor(params: CreateModelVersionParams) {
    this.validateVersionString(params.version);
    this.validateLimits(params.limits);
    this.validatePricing(params.pricing);
    this.validateModalities(params.modalities);

    this.id = params.id ?? randomUUID();
    this.canonicalModelId = params.canonicalModelId;
    this.version = params.version;
    this._modalities = Object.freeze([...params.modalities]);
    this._capabilities = Object.freeze({ ...params.capabilities });
    this._limits = Object.freeze({ ...params.limits });
    this._pricing = Object.freeze({ ...params.pricing });
    this._status = params.status ?? 'available';
    this._isImmutable = params.isImmutable ?? false;
    this.createdAt = params.createdAt ?? new Date().toISOString();
    this._updatedAt = params.updatedAt ?? this.createdAt;
  }

  get modalities(): readonly ModelModality[] {
    return this._modalities;
  }

  get capabilities(): ModelCapabilities {
    return this._capabilities;
  }

  get limits(): ModelLimits {
    return this._limits;
  }

  get pricing(): ModelPricing {
    return this._pricing;
  }

  get status(): AvailabilityStatus {
    return this._status;
  }

  get isImmutable(): boolean {
    return this._isImmutable;
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  public publish(): void {
    this._isImmutable = true;
    this._status = 'available';
    this._updatedAt = new Date().toISOString();
  }

  public updateStatus(newStatus: AvailabilityStatus): void {
    this._status = newStatus;
    this._updatedAt = new Date().toISOString();
  }

  public updateSpecifications(
    capabilities: ModelCapabilities,
    limits: ModelLimits,
    pricing: ModelPricing,
    modalities: readonly ModelModality[],
  ): void {
    if (this._isImmutable) {
      throw new ImmutableVersionViolationError(
        this.canonicalModelId,
        this.version,
        'specifications (capabilities, limits, pricing, modalities)',
      );
    }

    this.validateLimits(limits);
    this.validatePricing(pricing);
    this.validateModalities(modalities);

    this._capabilities = Object.freeze({ ...capabilities });
    this._limits = Object.freeze({ ...limits });
    this._pricing = Object.freeze({ ...pricing });
    this._modalities = Object.freeze([...modalities]);
    this._updatedAt = new Date().toISOString();
  }

  public toJSON(): ModelVersionData {
    return {
      id: this.id,
      canonicalModelId: this.canonicalModelId,
      version: this.version,
      modalities: this._modalities,
      capabilities: this._capabilities,
      limits: this._limits,
      pricing: this._pricing,
      status: this._status,
      isImmutable: this._isImmutable,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }

  private validateVersionString(version: string): void {
    if (!version || typeof version !== 'string' || !SEMVER_REGEX.test(version)) {
      throw new ModelValidationError(
        `Invalid version format '${version}'. Must adhere to SemVer (e.g. 'v1.0.0' or '1.0.0')`,
        'version',
      );
    }
  }

  private validateLimits(limits: ModelLimits): void {
    if (!limits || typeof limits !== 'object') {
      throw new ModelValidationError('Model limits must be provided', 'limits');
    }
    if (typeof limits.contextWindowTokens !== 'number' || limits.contextWindowTokens <= 0) {
      throw new ModelValidationError(
        'contextWindowTokens must be a positive integer > 0',
        'limits.contextWindowTokens',
      );
    }
    if (typeof limits.maxOutputTokens !== 'number' || limits.maxOutputTokens <= 0) {
      throw new ModelValidationError(
        'maxOutputTokens must be a positive integer > 0',
        'limits.maxOutputTokens',
      );
    }
  }

  private validatePricing(pricing: ModelPricing): void {
    if (!pricing || typeof pricing !== 'object') {
      throw new ModelValidationError('Model pricing must be provided', 'pricing');
    }
    if (
      typeof pricing.costPerMillionInputTokens !== 'number' ||
      pricing.costPerMillionInputTokens < 0
    ) {
      throw new ModelValidationError(
        'costPerMillionInputTokens must be a non-negative number >= 0',
        'pricing.costPerMillionInputTokens',
      );
    }
    if (
      typeof pricing.costPerMillionOutputTokens !== 'number' ||
      pricing.costPerMillionOutputTokens < 0
    ) {
      throw new ModelValidationError(
        'costPerMillionOutputTokens must be a non-negative number >= 0',
        'pricing.costPerMillionOutputTokens',
      );
    }
    if (
      pricing.costPerMillionCachedTokens !== undefined &&
      (typeof pricing.costPerMillionCachedTokens !== 'number' ||
        pricing.costPerMillionCachedTokens < 0)
    ) {
      throw new ModelValidationError(
        'costPerMillionCachedTokens must be a non-negative number >= 0',
        'pricing.costPerMillionCachedTokens',
      );
    }
  }

  private validateModalities(modalities: readonly ModelModality[]): void {
    if (!Array.isArray(modalities) || modalities.length === 0) {
      throw new ModelValidationError(
        'At least one modality must be defined for a model version',
        'modalities',
      );
    }
  }
}
