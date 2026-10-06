export type AgentErrorCode =
  | 'INVALID_REQUEST'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_VERSION_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'INVALID_RUN_STATE'
  | 'STEP_LIMIT_EXCEEDED'
  | 'BUDGET_EXCEEDED'
  | 'CONSECUTIVE_ERRORS_EXCEEDED'
  | 'CONFIRMATION_EXPIRED'
  | 'CONFIRMATION_REJECTED'
  | 'INPUT_TIMEOUT'
  | 'PERMISSION_DENIED'
  | 'POLICY_VIOLATION'
  | 'DEADLINE_EXCEEDED'
  | 'INFERENCE_FAILURE'
  | 'TOOL_EXECUTION_FAILURE'
  | 'KNOWLEDGE_RETRIEVAL_FAILURE'
  | 'INTERNAL_AGENT_ERROR';

export abstract class AgentDomainError extends Error {
  public readonly code: AgentErrorCode;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(
    code: AgentErrorCode,
    message: string,
    statusCode = 400,
    retryable = false,
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidRequestError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_REQUEST', message, 400, false, details);
  }
}

export class AgentNotFoundError extends AgentDomainError {
  constructor(agentId: string) {
    super('AGENT_NOT_FOUND', `Agent '${agentId}' not found`, 404, false, { agentId });
  }
}

export class AgentVersionNotFoundError extends AgentDomainError {
  constructor(agentId: string, version: string) {
    super(
      'AGENT_VERSION_NOT_FOUND',
      `Version '${version}' for agent '${agentId}' not found`,
      404,
      false,
      { agentId, version },
    );
  }
}

export class RunNotFoundError extends AgentDomainError {
  constructor(runId: string) {
    super('RUN_NOT_FOUND', `Agent run '${runId}' not found`, 404, false, { runId });
  }
}

export class InvalidRunStateError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_RUN_STATE', message, 409, false, details);
  }
}

export class StepLimitExceededError extends AgentDomainError {
  constructor(maxSteps: number, runId: string) {
    super(
      'STEP_LIMIT_EXCEEDED',
      `Agent run '${runId}' exceeded maximum steps limit of ${maxSteps}`,
      422,
      false,
      { maxSteps, runId },
    );
  }
}

export class BudgetExceededError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('BUDGET_EXCEEDED', message, 422, false, details);
  }
}

export class ConsecutiveErrorsExceededError extends AgentDomainError {
  constructor(consecutiveErrors: number, runId: string) {
    super(
      'CONSECUTIVE_ERRORS_EXCEEDED',
      `Agent run '${runId}' halted after ${consecutiveErrors} consecutive errors`,
      422,
      false,
      { consecutiveErrors, runId },
    );
  }
}

export class ConfirmationExpiredError extends AgentDomainError {
  constructor(runId: string, confirmationId: string) {
    super(
      'CONFIRMATION_EXPIRED',
      `Confirmation challenge '${confirmationId}' for run '${runId}' has expired`,
      410,
      false,
      { runId, confirmationId },
    );
  }
}

export class ConfirmationRejectedError extends AgentDomainError {
  constructor(runId: string, confirmationId: string) {
    super(
      'CONFIRMATION_REJECTED',
      `Confirmation challenge '${confirmationId}' for run '${runId}' was rejected`,
      403,
      false,
      { runId, confirmationId },
    );
  }
}

export class InputTimeoutError extends AgentDomainError {
  constructor(runId: string, inputId: string) {
    super(
      'INPUT_TIMEOUT',
      `User input challenge '${inputId}' for run '${runId}' timed out`,
      410,
      false,
      { runId, inputId },
    );
  }
}

export class PermissionDeniedError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('PERMISSION_DENIED', message, 403, false, details);
  }
}

export class PolicyViolationError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('POLICY_VIOLATION', message, 403, false, details);
  }
}

export class DeadlineExceededError extends AgentDomainError {
  constructor(runId: string, deadlineMs: number) {
    super(
      'DEADLINE_EXCEEDED',
      `Execution deadline (${new Date(deadlineMs).toISOString()}) expired for run '${runId}'`,
      504,
      true,
      { runId, deadlineMs },
    );
  }
}

export class InferenceFailureError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('INFERENCE_FAILURE', message, 502, true, details);
  }
}

export class ToolExecutionFailureError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('TOOL_EXECUTION_FAILURE', message, 502, true, details);
  }
}

export class KnowledgeRetrievalFailureError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('KNOWLEDGE_RETRIEVAL_FAILURE', message, 502, true, details);
  }
}

export class InternalAgentError extends AgentDomainError {
  constructor(message: string, details?: unknown) {
    super('INTERNAL_AGENT_ERROR', message, 500, false, details);
  }
}

export class RequestCancelledError extends AgentDomainError {
  constructor(message = 'Request was cancelled', details?: unknown) {
    super('INTERNAL_AGENT_ERROR', message, 499, false, details);
  }
}
