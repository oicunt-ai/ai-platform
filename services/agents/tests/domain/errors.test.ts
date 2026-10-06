import { describe, expect, it } from 'vitest';
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  BudgetExceededError,
  ConfirmationExpiredError,
  ConfirmationRejectedError,
  ConsecutiveErrorsExceededError,
  DeadlineExceededError,
  InferenceFailureError,
  InputTimeoutError,
  InvalidRequestError,
  InvalidRunStateError,
  PermissionDeniedError,
  PolicyViolationError,
  RunNotFoundError,
  StepLimitExceededError,
  ToolExecutionFailureError,
} from '../../src/domain/errors.js';

describe('Agent Domain Errors', () => {
  it('maps correct HTTP status codes and retryability flags', () => {
    const invalidReq = new InvalidRequestError('bad input');
    expect(invalidReq.statusCode).toBe(400);
    expect(invalidReq.retryable).toBe(false);
    expect(invalidReq.code).toBe('INVALID_REQUEST');

    const agentNotFound = new AgentNotFoundError('oicunt.agent.unknown');
    expect(agentNotFound.statusCode).toBe(404);
    expect(agentNotFound.retryable).toBe(false);

    const versionNotFound = new AgentVersionNotFoundError('oicunt.agent.unknown', '2.0.0');
    expect(versionNotFound.statusCode).toBe(404);

    const runNotFound = new RunNotFoundError('run_123');
    expect(runNotFound.statusCode).toBe(404);

    const invalidState = new InvalidRunStateError('cannot resume');
    expect(invalidState.statusCode).toBe(409);

    const stepLimit = new StepLimitExceededError(15, 'run_123');
    expect(stepLimit.statusCode).toBe(422);

    const budgetExceeded = new BudgetExceededError('tokens exceeded');
    expect(budgetExceeded.statusCode).toBe(422);

    const consecutiveErrors = new ConsecutiveErrorsExceededError(3, 'run_123');
    expect(consecutiveErrors.statusCode).toBe(422);

    const confExpired = new ConfirmationExpiredError('run_123', 'conf_456');
    expect(confExpired.statusCode).toBe(410);

    const confRejected = new ConfirmationRejectedError('run_123', 'conf_456');
    expect(confRejected.statusCode).toBe(403);

    const inputTimeout = new InputTimeoutError('run_123', 'inp_789');
    expect(inputTimeout.statusCode).toBe(410);

    const permDenied = new PermissionDeniedError('forbidden');
    expect(permDenied.statusCode).toBe(403);

    const policyViolation = new PolicyViolationError('disallowed action');
    expect(policyViolation.statusCode).toBe(403);

    const deadlineExceeded = new DeadlineExceededError('run_123', Date.now());
    expect(deadlineExceeded.statusCode).toBe(504);
    expect(deadlineExceeded.retryable).toBe(true);

    const inferenceFailure = new InferenceFailureError('gateway error');
    expect(inferenceFailure.statusCode).toBe(502);
    expect(inferenceFailure.retryable).toBe(true);

    const toolFailure = new ToolExecutionFailureError('sandbox failure');
    expect(toolFailure.statusCode).toBe(502);
    expect(toolFailure.retryable).toBe(true);
  });
});
