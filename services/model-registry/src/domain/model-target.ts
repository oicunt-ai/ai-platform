import type { ModelProviderType } from '@oicunt-ai/model-types';
import type { AvailabilityStatus, ModelTargetData } from './types.js';
import { ModelValidationError } from './errors.js';

export interface CreateModelTargetParams {
  readonly id: string;
  readonly modelVersionId: string;
  readonly provider: ModelProviderType;
  readonly upstreamModelId: string;
  readonly priority?: number | undefined;
  readonly weight?: number | undefined;
  readonly region?: string | undefined;
  readonly adapterOptions?: Record<string, unknown> | undefined;
  readonly supportsStreaming?: boolean | undefined;
  readonly status?: AvailabilityStatus | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

const PROVIDER_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const SECRET_KEY_PATTERN =
  /(^|[_-])(api[-_]?key|token|secret|password|authorization|credential)s?($|[_-])/i;

function assertNoSecrets(value: unknown, path = 'adapterOptions'): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new ModelValidationError(
        `Provider credentials are not permitted in model registry metadata (${childPath})`,
        childPath,
      );
    }
    assertNoSecrets(child, childPath);
  }
}

export class ModelTarget {
  public readonly id: string;
  public readonly modelVersionId: string;
  public readonly provider: ModelProviderType;
  public readonly upstreamModelId: string;
  public readonly priority: number;
  public readonly weight: number;
  public readonly region?: string | undefined;
  public readonly adapterOptions?: Record<string, unknown> | undefined;
  public readonly supportsStreaming: boolean;
  private _status: AvailabilityStatus;
  public readonly maxConcurrency?: number | undefined;
  public readonly createdAt: string;
  private _updatedAt: string;

  constructor(params: CreateModelTargetParams) {
    this.validateTargetId(params.id);
    this.validateProvider(params.provider);
    this.validateUpstreamModelId(params.upstreamModelId);

    const priority = params.priority ?? 1;
    const weight = params.weight ?? 100;

    this.validatePriority(priority);
    this.validateWeight(weight);
    assertNoSecrets(params.adapterOptions);

    this.id = params.id;
    this.modelVersionId = params.modelVersionId;
    this.provider = params.provider;
    this.upstreamModelId = params.upstreamModelId;
    this.priority = priority;
    this.weight = weight;
    this.region = params.region;
    this.adapterOptions = params.adapterOptions
      ? Object.freeze({ ...params.adapterOptions })
      : undefined;
    this.supportsStreaming = params.supportsStreaming ?? true;
    this._status = params.status ?? 'available';
    this.maxConcurrency = params.maxConcurrency;
    this.createdAt = params.createdAt ?? new Date().toISOString();
    this._updatedAt = params.updatedAt ?? this.createdAt;
  }

  get status(): AvailabilityStatus {
    return this._status;
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  public updateStatus(newStatus: AvailabilityStatus): void {
    this._status = newStatus;
    this._updatedAt = new Date().toISOString();
  }

  public isAvailable(): boolean {
    return this._status === 'available';
  }

  public isDegraded(): boolean {
    return this._status === 'degraded';
  }

  public isEligible(allowDegraded = true): boolean {
    if (this._status === 'maintenance' || this._status === 'deprecated') {
      return false;
    }
    if (this._status === 'available') {
      return true;
    }
    return allowDegraded && this._status === 'degraded';
  }

  public toJSON(): ModelTargetData {
    return {
      id: this.id,
      modelVersionId: this.modelVersionId,
      provider: this.provider,
      upstreamModelId: this.upstreamModelId,
      priority: this.priority,
      weight: this.weight,
      region: this.region,
      adapterOptions: this.adapterOptions,
      supportsStreaming: this.supportsStreaming,
      status: this._status,
      maxConcurrency: this.maxConcurrency,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }

  private validateTargetId(id: string): void {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new ModelValidationError('Target ID cannot be empty', 'id');
    }
  }

  private validateProvider(provider: ModelProviderType): void {
    if (!provider || typeof provider !== 'string' || !PROVIDER_ID_REGEX.test(provider)) {
      throw new ModelValidationError(
        `Invalid model provider '${provider}'. Provider IDs must use lowercase letters, numbers, dots, underscores, or hyphens`,
        'provider',
      );
    }
  }

  private validateUpstreamModelId(upstreamModelId: string): void {
    if (!upstreamModelId || typeof upstreamModelId !== 'string' || !upstreamModelId.trim()) {
      throw new ModelValidationError('upstreamModelId cannot be empty', 'upstreamModelId');
    }
    if (/\s/.test(upstreamModelId)) {
      throw new ModelValidationError(
        'upstreamModelId cannot contain whitespace',
        'upstreamModelId',
      );
    }
  }

  private validatePriority(priority: number): void {
    if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 1) {
      throw new ModelValidationError('Target priority must be a positive integer >= 1', 'priority');
    }
  }

  private validateWeight(weight: number): void {
    if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1 || weight > 100) {
      throw new ModelValidationError(
        'Target weight must be an integer between 1 and 100',
        'weight',
      );
    }
  }
}
