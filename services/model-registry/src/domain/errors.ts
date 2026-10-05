import { ModelDomainError } from '@oicunt-ai/model-types';

export class ModelNotFoundError extends ModelDomainError {
  constructor(public readonly canonicalModelId: string) {
    super('MODEL_NOT_FOUND', `Canonical model '${canonicalModelId}' was not found in the catalog`);
  }
}

export class VersionNotFoundError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly version: string,
  ) {
    super(
      'VERSION_NOT_FOUND',
      `Version '${version}' was not found for model '${canonicalModelId}'`,
    );
  }
}

export class ModelDeprecatedError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly version: string,
  ) {
    super(
      'MODEL_DEPRECATED',
      `Model '${canonicalModelId}' version '${version}' is permanently deprecated and retired`,
    );
  }
}

export class ModelInMaintenanceError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly version: string,
  ) {
    super(
      'MODEL_IN_MAINTENANCE',
      `Model '${canonicalModelId}' version '${version}' is currently undergoing maintenance`,
    );
  }
}

export class NoEligibleTargetsError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly version: string,
  ) {
    super(
      'NO_ELIGIBLE_TARGETS',
      `No active, healthy execution targets exist for model '${canonicalModelId}' version '${version}'`,
    );
  }
}

export class InvalidRoutingPolicyError extends ModelDomainError {
  constructor(message: string) {
    super('INVALID_ROUTING_POLICY', message);
  }
}

export class AliasCycleDetectedError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly aliasName: string,
  ) {
    super(
      'ALIAS_CYCLE_DETECTED',
      `Circular alias loop detected for model '${canonicalModelId}' on alias '${aliasName}'`,
    );
  }
}

export class ImmutableVersionViolationError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly version: string,
    public readonly field: string,
  ) {
    super(
      'IMMUTABLE_VERSION_VIOLATION',
      `Cannot mutate immutable field '${field}' on published version '${version}' of model '${canonicalModelId}'`,
    );
  }
}

export class ModelValidationError extends ModelDomainError {
  constructor(
    message: string,
    public readonly field?: string | undefined,
  ) {
    super('VALIDATION_FAILED', message);
  }
}

export class OptimisticLockError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      'OPTIMISTIC_LOCK_CONFLICT',
      `Optimistic lock conflict on model '${canonicalModelId}': expected version ${expectedVersion}, but found ${actualVersion}`,
    );
  }
}

export class UnsupportedEffortError extends ModelDomainError {
  constructor(
    public readonly canonicalModelId: string,
    public readonly version: string,
    public readonly effort: string,
    public readonly supportedLevels: readonly string[],
  ) {
    const supportedStr =
      supportedLevels.length > 0
        ? `Supported levels: [${supportedLevels.join(', ')}]`
        : 'Model does not support reasoning effort configuration';
    super(
      'UNSUPPORTED_EFFORT_LEVEL',
      `Model '${canonicalModelId}' version '${version}' does not support reasoning effort level '${effort}'. ${supportedStr}`,
    );
  }
}
