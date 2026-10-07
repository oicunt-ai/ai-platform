import { McpSecurityError } from '../../domain/errors.js';

const RAW_TOKEN_PATTERNS = [
  /^Bearer\s+/i,
  /^Basic\s+/i,
  /^sk-[A-Za-z0-9_-]/,
  /^gh[pousr][_-][A-Za-z0-9_]/,
  /^glpat[_-][A-Za-z0-9_-]/,
  /^xox[baprs][_-][A-Za-z0-9_-]/,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT signature pattern
];

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'api-key',
  'x-api-key',
  'token',
  'x-token',
  'secret',
  'auth',
];

/**
 * Validates that authSecretRef is strictly an opaque reference key and not a raw credential.
 */
export function validateAuthSecretRef(ref?: string): void {
  if (!ref) return;

  const trimmed = ref.trim();

  if (trimmed.length > 128) {
    throw new McpSecurityError(
      'authSecretRef exceeds maximum allowed reference identifier length of 128 characters',
    );
  }

  if (/\s/.test(trimmed)) {
    throw new McpSecurityError('authSecretRef must not contain whitespace');
  }

  for (const pattern of RAW_TOKEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new McpSecurityError(
        'authSecretRef must be a secret reference identifier, not a raw secret or token',
      );
    }
  }
}

/**
 * Validates transport headers to ensure raw credentials are never persisted in registrations.
 */
export function validateTransportHeaders(headers?: Record<string, string>): void {
  if (!headers) return;

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADER_KEYS.some((sk) => lowerKey.includes(sk))) {
      for (const pattern of RAW_TOKEN_PATTERNS) {
        if (pattern.test(value.trim())) {
          throw new McpSecurityError(
            `Raw authentication credential detected in header '${key}'. Raw credentials must never be persisted in configuration. Use authSecretRef instead.`,
          );
        }
      }

      if (lowerKey === 'authorization' || lowerKey.endsWith('token') || lowerKey.endsWith('key')) {
        throw new McpSecurityError(
          `Persisting credentials in header '${key}' is prohibited. Use authSecretRef for credential containment.`,
        );
      }
    }
  }
}
