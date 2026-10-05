import { randomUUID } from 'node:crypto';
import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { ModelAliasData } from './types.js';
import { ModelValidationError } from './errors.js';

export interface CreateModelAliasParams {
  readonly id?: string | undefined;
  readonly canonicalModelId: CanonicalModelId;
  readonly aliasName: string;
  readonly targetVersion: string;
  readonly tenantId?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

const ALIAS_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

export class ModelAlias {
  public readonly id: string;
  public readonly canonicalModelId: CanonicalModelId;
  public readonly aliasName: string;
  public readonly targetVersion: string;
  public readonly tenantId?: string | undefined;
  public readonly createdAt: string;
  public readonly updatedAt: string;

  constructor(params: CreateModelAliasParams) {
    this.validateAliasName(params.aliasName);
    this.validateTargetVersion(params.targetVersion);

    if (params.aliasName === params.targetVersion) {
      throw new ModelValidationError(
        `Alias '${params.aliasName}' cannot directly reference itself as the target version`,
        'aliasName',
      );
    }

    this.id = params.id ?? randomUUID();
    this.canonicalModelId = params.canonicalModelId;
    this.aliasName = params.aliasName.trim().toLowerCase();
    this.targetVersion = params.targetVersion.trim();
    this.tenantId = params.tenantId?.trim() || undefined;
    this.createdAt = params.createdAt ?? new Date().toISOString();
    this.updatedAt = params.updatedAt ?? this.createdAt;
  }

  public toJSON(): ModelAliasData {
    return {
      id: this.id,
      canonicalModelId: this.canonicalModelId,
      aliasName: this.aliasName,
      targetVersion: this.targetVersion,
      tenantId: this.tenantId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private validateAliasName(aliasName: string): void {
    if (!aliasName || typeof aliasName !== 'string' || !aliasName.trim()) {
      throw new ModelValidationError('Alias name cannot be empty', 'aliasName');
    }
    if (!ALIAS_NAME_REGEX.test(aliasName.trim())) {
      throw new ModelValidationError(
        `Alias name '${aliasName}' contains invalid characters. Must be alphanumeric, dashes, underscores, or dots`,
        'aliasName',
      );
    }
  }

  private validateTargetVersion(version: string): void {
    if (!version || typeof version !== 'string' || !version.trim()) {
      throw new ModelValidationError('Target version cannot be empty', 'targetVersion');
    }
  }
}
