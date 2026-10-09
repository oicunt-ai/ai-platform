import {
  ContentPolicyViolationError,
  ContextWindowExceededError,
  type GatewayError,
  InvalidRequestError,
  ModelUnavailableError,
  ProviderAuthenticationError,
  RateLimitExceededError,
} from '../../../domain/errors.js';
import type { GroqErrorBody } from './groq.types.js';

function extractErrorFields(errorBody: GroqErrorBody | string | undefined): {
  type: string;
  code: string;
  message: string;
} {
  if (typeof errorBody === 'string') return { type: '', code: '', message: errorBody };
  const nested = errorBody?.error;
  if (!nested || typeof nested !== 'object') return { type: '', code: '', message: '' };
  return {
    type: typeof nested.type === 'string' ? nested.type : '',
    code: typeof nested.code === 'string' ? nested.code : '',
    message: typeof nested.message === 'string' ? nested.message : '',
  };
}

/**
 * Maps Groq (OpenAI-compatible) HTTP failures to normalized gateway errors.
 * Provider messages are never propagated; only normalized codes cross the boundary.
 */
export function mapGroqError(params: {
  status: number;
  errorBody?: GroqErrorBody | string | undefined;
  canonicalModelId: string;
  correlationId: string;
  targetId?: string | undefined;
}): GatewayError {
  const { status, errorBody, canonicalModelId, correlationId, targetId } = params;
  const { type, code, message } = extractErrorFields(errorBody);
  const marker = `${type} ${code} ${message}`.toLowerCase();

  // 1. Authentication & permission failures. Never leak key material.
  if (
    status === 401 ||
    status === 403 ||
    marker.includes('invalid_api_key') ||
    marker.includes('invalid api key') ||
    marker.includes('authentication') ||
    marker.includes('incorrect api key')
  ) {
    return new ProviderAuthenticationError(canonicalModelId, correlationId, targetId);
  }

  // 2. Throughput / rate limits.
  if (status === 429 || marker.includes('rate_limit') || marker.includes('rate limit')) {
    return new RateLimitExceededError(canonicalModelId, correlationId, targetId);
  }

  // 3. Unknown upstream model or route: configuration-level failure surfaced as unavailable.
  if (status === 404 || marker.includes('model_not_found') || marker.includes('no such model')) {
    return new ModelUnavailableError(canonicalModelId, correlationId, targetId);
  }

  // 4. Upstream outages and transport failures.
  if (status >= 500 || marker.includes('overloaded') || marker.includes('timeout')) {
    return new ModelUnavailableError(canonicalModelId, correlationId, targetId);
  }

  // 5. Client errors: distinguish context window, policy, and malformed payloads.
  if (status === 400 || type === 'invalid_request_error') {
    if (
      marker.includes('context') ||
      marker.includes('maximum context') ||
      marker.includes('too many tokens') ||
      marker.includes('token limit') ||
      marker.includes('max_tokens') ||
      marker.includes('maximum number of tokens')
    ) {
      return new ContextWindowExceededError(canonicalModelId, correlationId, {
        providerReason: 'context_length_exceeded',
      });
    }
    if (
      marker.includes('content policy') ||
      marker.includes('safety') ||
      marker.includes('moderation') ||
      marker.includes('harmful')
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
