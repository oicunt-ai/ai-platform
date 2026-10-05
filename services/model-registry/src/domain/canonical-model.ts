import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { AvailabilityStatus, CanonicalModelData } from './types.js';
import { ModelVersion } from './model-version.js';
import { ModelTarget } from './model-target.js';
import { RoutingPolicy } from './routing-policy.js';
import { ModelAlias } from './model-alias.js';
import {
  AliasCycleDetectedError,
  ModelValidationError,
  NoEligibleTargetsError,
  VersionNotFoundError,
} from './errors.js';

export interface CreateCanonicalModelParams {
  readonly id: CanonicalModelId;
  readonly displayName: string;
  readonly description: string;
  readonly activeVersion: string;
  readonly versionLock?: number | undefined;
  readonly versions?: readonly ModelVersion[] | undefined;
  readonly targets?: readonly ModelTarget[] | undefined;
  readonly routingPolicy?: RoutingPolicy | undefined;
  readonly aliases?: readonly ModelAlias[] | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

const CANONICAL_MODEL_ID_REGEX = /^oicunt\.model\.[a-z0-9-]+$/;

export class CanonicalModel {
  public readonly id: CanonicalModelId;
  private _displayName: string;
  private _description: string;
  private _activeVersion: string;
  private _versionLock: number;
  private readonly _versions: Map<string, ModelVersion> = new Map();
  private readonly _targets: Map<string, ModelTarget> = new Map();
  private _routingPolicy: RoutingPolicy;
  private readonly _aliases: Map<string, ModelAlias> = new Map();
  public readonly createdAt: string;
  private _updatedAt: string;

  constructor(params: CreateCanonicalModelParams) {
    this.validateCanonicalModelId(params.id);
    this.validateDisplayName(params.displayName);
    this.validateDescription(params.description);
    this.validateActiveVersion(params.activeVersion);

    this.id = params.id;
    this._displayName = params.displayName.trim();
    this._description = params.description.trim();
    this._activeVersion = params.activeVersion.trim();
    this._versionLock = params.versionLock ?? 1;
    this.createdAt = params.createdAt ?? new Date().toISOString();
    this._updatedAt = params.updatedAt ?? this.createdAt;

    if (params.versions) {
      for (const v of params.versions) {
        this._versions.set(v.version, v);
      }
    }

    if (params.targets) {
      for (const t of params.targets) {
        this._targets.set(t.id, t);
      }
    }

    this._routingPolicy =
      params.routingPolicy ??
      new RoutingPolicy({
        canonicalModelId: this.id,
      });

    if (params.aliases) {
      for (const a of params.aliases) {
        const key = this.getAliasKey(a.aliasName, a.tenantId);
        this._aliases.set(key, a);
      }
    }
  }

  get displayName(): string {
    return this._displayName;
  }

  get description(): string {
    return this._description;
  }

  get activeVersion(): string {
    return this._activeVersion;
  }

  get versionLock(): number {
    return this._versionLock;
  }

  get routingPolicy(): RoutingPolicy {
    return this._routingPolicy;
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  public getVersions(): readonly ModelVersion[] {
    return Array.from(this._versions.values());
  }

  public getVersion(version: string): ModelVersion | undefined {
    return this._versions.get(version);
  }

  public getTargets(): readonly ModelTarget[] {
    return Array.from(this._targets.values());
  }

  public getTarget(targetId: string): ModelTarget | undefined {
    return this._targets.get(targetId);
  }

  public getAliases(): readonly ModelAlias[] {
    return Array.from(this._aliases.values());
  }

  public getAlias(aliasName: string, tenantId?: string): ModelAlias | undefined {
    const key = this.getAliasKey(aliasName, tenantId);
    return this._aliases.get(key);
  }

  public incrementVersionLock(): void {
    this._versionLock += 1;
    this._updatedAt = new Date().toISOString();
  }

  public updateMetadata(displayName: string, description: string): void {
    this.validateDisplayName(displayName);
    this.validateDescription(description);
    this._displayName = displayName.trim();
    this._description = description.trim();
    this._updatedAt = new Date().toISOString();
  }

  public setActiveVersion(version: string): void {
    if (!this._versions.has(version)) {
      throw new VersionNotFoundError(this.id, version);
    }
    this._activeVersion = version;
    this._updatedAt = new Date().toISOString();
  }

  public addVersion(version: ModelVersion): void {
    if (this._versions.has(version.version)) {
      throw new ModelValidationError(
        `Version '${version.version}' already exists on model '${this.id}'`,
        'version',
      );
    }
    this._versions.set(version.version, version);
    this._updatedAt = new Date().toISOString();
  }

  public updateVersionStatus(versionString: string, status: AvailabilityStatus): ModelVersion {
    const version = this._versions.get(versionString);
    if (!version) {
      throw new VersionNotFoundError(this.id, versionString);
    }
    version.updateStatus(status);
    this._updatedAt = new Date().toISOString();
    return version;
  }

  public addTarget(target: ModelTarget): void {
    if (this._targets.has(target.id)) {
      throw new ModelValidationError(
        `Target '${target.id}' already exists on model '${this.id}'`,
        'id',
      );
    }
    // Verify that target references a valid version in this model
    const versionExists = Array.from(this._versions.values()).some(
      (v) => v.id === target.modelVersionId,
    );
    if (!versionExists) {
      throw new ModelValidationError(
        `Target '${target.id}' references non-existent modelVersionId '${target.modelVersionId}'`,
        'modelVersionId',
      );
    }

    this._targets.set(target.id, target);
    this._updatedAt = new Date().toISOString();
  }

  public updateTargetStatus(targetId: string, status: AvailabilityStatus): ModelTarget {
    const target = this._targets.get(targetId);
    if (!target) {
      throw new ModelValidationError(
        `Target '${targetId}' was not found on model '${this.id}'`,
        'targetId',
      );
    }
    target.updateStatus(status);
    this._updatedAt = new Date().toISOString();
    return target;
  }

  public updateRoutingPolicy(policy: RoutingPolicy): void {
    this._routingPolicy = policy;
    this._updatedAt = new Date().toISOString();
  }

  public setAlias(alias: ModelAlias): void {
    // Validate target exists or points to another alias without cycles
    this.detectAliasCycles(alias.aliasName, alias.targetVersion, alias.tenantId);

    const key = this.getAliasKey(alias.aliasName, alias.tenantId);
    this._aliases.set(key, alias);
    this._updatedAt = new Date().toISOString();
  }

  /**
   * Deterministically resolves a version string or alias name to a concrete ModelVersion entity.
   */
  public resolveVersion(
    requestedVersionOrAlias?: string | undefined,
    tenantId?: string | undefined,
  ): ModelVersion {
    const targetString = requestedVersionOrAlias?.trim() || this._activeVersion;

    // Direct version match
    const directVersion = this._versions.get(targetString);
    if (directVersion) {
      return directVersion;
    }

    // Alias lookup
    const resolvedVersionString = this.resolveAliasChain(targetString, tenantId);
    const resolvedVersion = this._versions.get(resolvedVersionString);
    if (!resolvedVersion) {
      throw new VersionNotFoundError(this.id, resolvedVersionString);
    }

    return resolvedVersion;
  }

  /**
   * Returns ordered eligible execution targets for a resolved version.
   * Deterministic ordering: priority ASC (1 before 2), weight DESC (100 before 50), id ASC.
   * Targets in 'maintenance' or 'deprecated' are strictly excluded.
   */
  public getEligibleTargets(versionId: string, allowDegraded = true): readonly ModelTarget[] {
    const candidates = Array.from(this._targets.values()).filter(
      (target) => target.modelVersionId === versionId && target.isEligible(allowDegraded),
    );

    if (candidates.length === 0) {
      // Find version string for error message
      const ver = Array.from(this._versions.values()).find((v) => v.id === versionId);
      throw new NoEligibleTargetsError(this.id, ver?.version ?? versionId);
    }

    return Object.freeze(
      candidates.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        if (a.weight !== b.weight) {
          return b.weight - a.weight;
        }
        return a.id.localeCompare(b.id);
      }),
    );
  }

  public toJSON(): CanonicalModelData {
    return {
      id: this.id,
      displayName: this._displayName,
      description: this._description,
      activeVersion: this._activeVersion,
      versionLock: this._versionLock,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }

  private getAliasKey(aliasName: string, tenantId?: string | undefined): string {
    return `${aliasName.toLowerCase()}:${tenantId ?? '__global__'}`;
  }

  private resolveAliasChain(initialIdentifier: string, tenantId?: string | undefined): string {
    let current = initialIdentifier;
    const visited = new Set<string>();

    while (true) {
      if (this._versions.has(current)) {
        return current;
      }

      if (visited.has(current.toLowerCase())) {
        throw new AliasCycleDetectedError(this.id, initialIdentifier);
      }
      visited.add(current.toLowerCase());

      // Try tenant override first, then global alias
      const tenantKey = this.getAliasKey(current, tenantId);
      const globalKey = this.getAliasKey(current, undefined);
      const alias = this._aliases.get(tenantKey) ?? this._aliases.get(globalKey);

      if (!alias) {
        throw new VersionNotFoundError(this.id, current);
      }

      current = alias.targetVersion;
    }
  }

  private detectAliasCycles(
    aliasName: string,
    targetVersion: string,
    tenantId?: string | undefined,
  ): void {
    const visited = new Set<string>();
    visited.add(aliasName.toLowerCase());

    let current = targetVersion;
    while (true) {
      if (this._versions.has(current)) {
        return;
      }
      if (visited.has(current.toLowerCase())) {
        throw new AliasCycleDetectedError(this.id, aliasName);
      }
      visited.add(current.toLowerCase());

      const tenantKey = this.getAliasKey(current, tenantId);
      const globalKey = this.getAliasKey(current, undefined);
      const alias = this._aliases.get(tenantKey) ?? this._aliases.get(globalKey);

      if (!alias) {
        // Target is either a version that doesn't exist yet, or undefined alias
        return;
      }
      current = alias.targetVersion;
    }
  }

  private validateCanonicalModelId(id: string): void {
    if (!id || typeof id !== 'string' || !CANONICAL_MODEL_ID_REGEX.test(id)) {
      throw new ModelValidationError(
        `Invalid canonical model ID '${id}'. Must match pattern '^oicunt\\.model\\.[a-z0-9\\-]+$'`,
        'id',
      );
    }
  }

  private validateDisplayName(displayName: string): void {
    if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
      throw new ModelValidationError('Display name cannot be empty', 'displayName');
    }
  }

  private validateDescription(description: string): void {
    if (!description || typeof description !== 'string' || !description.trim()) {
      throw new ModelValidationError('Description cannot be empty', 'description');
    }
  }

  private validateActiveVersion(activeVersion: string): void {
    if (!activeVersion || typeof activeVersion !== 'string' || !activeVersion.trim()) {
      throw new ModelValidationError('Active version cannot be empty', 'activeVersion');
    }
  }
}
