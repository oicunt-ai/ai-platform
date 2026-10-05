import type { ModelInvocationParameters, ModelLimits } from '@oicunt-ai/model-types';
import type { ChatMessage } from '@oicunt-ai/ai-types';
import {
  ContextWindowExceededError,
  InferenceTimeoutError,
  InvalidRequestError,
} from './errors.js';

export interface ValidatableInferenceRequest {
  readonly canonicalModelId: string;
  readonly messages: readonly ChatMessage[];
  readonly limits: ModelLimits;
  readonly deadlineMs: number;
  readonly parameters?: ModelInvocationParameters | undefined;
}

export function validateInferenceRequest(
  request: ValidatableInferenceRequest,
  correlationId = '',
): void {
  if (
    !request.canonicalModelId ||
    typeof request.canonicalModelId !== 'string' ||
    !request.canonicalModelId.trim()
  ) {
    throw new InvalidRequestError(
      'Missing or invalid canonicalModelId in inference request',
      correlationId,
    );
  }

  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new InvalidRequestError(
      'Inference request must contain at least one message',
      correlationId,
    );
  }

  for (let i = 0; i < request.messages.length; i++) {
    const msg = request.messages[i];
    if (!msg || typeof msg !== 'object') {
      throw new InvalidRequestError(`Message at index ${i} is not a valid object`, correlationId);
    }
    if (!msg.role || typeof msg.role !== 'string') {
      throw new InvalidRequestError(
        `Message at index ${i} is missing required 'role'`,
        correlationId,
      );
    }
    if (msg.content === undefined || msg.content === null) {
      throw new InvalidRequestError(
        `Message at index ${i} is missing required 'content'`,
        correlationId,
      );
    }
  }

  if (!request.limits || typeof request.limits !== 'object') {
    throw new InvalidRequestError(
      'Inference request is missing required model limits',
      correlationId,
    );
  }

  if (typeof request.limits.maxOutputTokens !== 'number' || request.limits.maxOutputTokens <= 0) {
    throw new InvalidRequestError(
      'Model limits must declare positive maxOutputTokens',
      correlationId,
    );
  }

  if (
    typeof request.limits.contextWindowTokens !== 'number' ||
    request.limits.contextWindowTokens <= 0
  ) {
    throw new InvalidRequestError(
      'Model limits must declare positive contextWindowTokens',
      correlationId,
    );
  }

  if (
    typeof request.deadlineMs !== 'number' ||
    Number.isNaN(request.deadlineMs) ||
    request.deadlineMs <= 0
  ) {
    throw new InvalidRequestError(
      'Inference request must declare a valid positive numeric deadlineMs',
      correlationId,
    );
  }

  if (Date.now() >= request.deadlineMs) {
    throw new InferenceTimeoutError(0, correlationId, {
      deadlineMs: request.deadlineMs,
      now: Date.now(),
      reason: 'Deadline has already expired prior to execution',
    });
  }

  if (request.parameters) {
    const p = request.parameters;
    if (p.temperature !== undefined) {
      if (typeof p.temperature !== 'number' || p.temperature < 0 || p.temperature > 2) {
        throw new InvalidRequestError(
          `Temperature parameter must be a number between 0 and 2. Received: ${p.temperature}`,
          correlationId,
        );
      }
    }

    if (p.topP !== undefined) {
      if (typeof p.topP !== 'number' || p.topP < 0 || p.topP > 1) {
        throw new InvalidRequestError(
          `topP parameter must be a number between 0 and 1. Received: ${p.topP}`,
          correlationId,
        );
      }
    }

    if (p.maxTokens !== undefined) {
      if (typeof p.maxTokens !== 'number' || p.maxTokens <= 0) {
        throw new InvalidRequestError(
          `maxTokens parameter must be a positive integer. Received: ${p.maxTokens}`,
          correlationId,
        );
      }
      if (p.maxTokens > request.limits.maxOutputTokens) {
        throw new ContextWindowExceededError(
          `Requested maxTokens (${p.maxTokens}) exceeds model maximum output tokens limit (${request.limits.maxOutputTokens})`,
          request.canonicalModelId,
          correlationId,
          {
            requestedMaxTokens: p.maxTokens,
            modelMaxOutputTokens: request.limits.maxOutputTokens,
          },
        );
      }
    }
  }
}
