export abstract class AiDomainError extends Error {
  public abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EntityNotFoundError extends AiDomainError {
  public readonly code = 'ENTITY_NOT_FOUND';

  constructor(entityName: string, id: string) {
    super(`${entityName} with identifier '${id}' was not found`);
  }
}

export class ValidationError extends AiDomainError {
  public readonly code = 'VALIDATION_FAILED';

  constructor(
    message: string,
    public readonly field?: string | undefined,
  ) {
    super(message);
  }
}

export class ConflictError extends AiDomainError {
  public readonly code = 'STATE_CONFLICT';

  constructor(message: string) {
    super(message);
  }
}

export class ModelNotFoundError extends AiDomainError {
  public readonly code = 'MODEL_NOT_FOUND';

  constructor(modelId: string) {
    super(`Canonical model '${modelId}' is not registered in the catalog`);
  }
}
