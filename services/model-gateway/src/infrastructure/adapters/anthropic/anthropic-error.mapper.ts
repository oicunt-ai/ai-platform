import {
  ContentPolicyViolationError,
  ContextWindowExceededError,
  GatewayError,
  InvalidRequestError,
  ModelUnavailableError,
  ProviderAuthenticationError,
  RateLimitExceededError,
} from '../../../domain/errors.js';
import type { AnthropicErrorResponse } from './anthropic.types.js';

export function mapAnthropicError(params: {
  status: number;
  errorBody?: AnthropicErrorResponse | string | undefined;
  canonicalModelId: string;
  correlationId: string;
  targetId?: string | undefined;
}): GatewayError {
  const { status, errorBody, canonicalModelId, correlationId, targetId } = params;
  const errorType =
    typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody
      ? errorBody.error?.type
      : undefined;
  const errorMessage =
    typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody
      ? errorBody.error?.message
      : typeof errorBody === 'string'
        ? errorBody
        : '';

  // 1. Authentication & Permission failures (401, 403)
  // Strips vendor tokens and raw secrets before bubbling to platform callers
  if (status === 401 || status === 403 || errorType === 'authentication_error') {
    return new ProviderAuthenticationError(canonicalModelId, correlationId, targetId);
  }

  // 2. Upstream Throughput / Rate limits (429)
  if (status === 429 || errorType === 'rate_limit_error') {
    return new RateLimitExceededError(canonicalModelId, correlationId, targetId);
  }

  // 3. Upstream Overloaded / Outages (529, 503, 500, 502, 504)
  if (
    status === 529 ||
    status === 503 ||
    status === 502 ||
    status === 500 ||
    errorType === 'overloaded_error' ||
    errorType === 'api_error'
  ) {
    return new ModelUnavailableError(canonicalModelId, correlationId, targetId);
  }

  // 4. Invalid Request & Context window overages (400)
  if (status === 400 || errorType === 'invalid_request_error') {
    const lowerMessage = errorMessage.toLowerCase();
    if (
      lowerMessage.includes('prompt is too long') ||
      lowerMessage.includes('context length') ||
      lowerMessage.includes('maximum context') ||
      lowerMessage.includes('max_tokens') ||
      lowerMessage.includes('too many tokens')
    ) {
      return new ContextWindowExceededError(canonicalModelId, correlationId, {
        providerReason: 'context_length_exceeded',
      });
    }

    if (
      lowerMessage.includes('content policy') ||
      lowerMessage.includes('safety') ||
      lowerMessage.includes('moderation')
    ) {
      return new ContentPolicyViolationError(canonicalModelId, correlationId, targetId);
    }

    return new InvalidRequestError(
      canonicalModelId,
      'Invalid model request payload.',
      correlationId,
    );
  }

  return new ModelUnavailableError(canonicalModelId, correlationId, targetId);
}
