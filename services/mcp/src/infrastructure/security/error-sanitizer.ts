const INTERNAL_PATH_PATTERN =
  /(?:[A-Za-z]:\\[^\s:"|?*]+|\/(?:home|usr|var|etc|opt|tmp|app)[^\s:"|?*]+)/g;
const INTERNAL_IP_PATTERN =
  /(?:127\.0\.0\.1|localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})/g;
const SECRET_PATTERN =
  /(?:Bearer\s+[A-Za-z0-9._~+/-]+|sk-[A-Za-z0-9_-]+|password=[^\s&]+|token=[^\s&]+)/gi;
const DB_ERROR_PATTERN =
  /(?:relation\s+"[^"]+"\s+does\s+not\s+exist|syntax\s+error\s+at\s+or\s+near|select\s+.*\s+from|insert\s+into|update\s+.*\s+set|delete\s+from|postgres|pg_|database\s+"[^"]+")/i;

/**
 * Sanitizes an error message before returning it to an external MCP client.
 * Strips stack traces, internal filesystem paths, private IPs, database details, and credentials.
 */
export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return 'An internal error occurred during tool execution';
  }

  // 1. Remove stack traces if present
  let sanitized = rawMessage.split('\n')[0]?.trim() ?? rawMessage;

  // 2. Check for internal database errors
  if (DB_ERROR_PATTERN.test(sanitized)) {
    return 'Internal database operation failed';
  }

  // 3. Mask secrets and tokens
  sanitized = sanitized.replace(SECRET_PATTERN, '[REDACTED_CREDENTIAL]');

  // 4. Mask internal filesystem paths
  sanitized = sanitized.replace(INTERNAL_PATH_PATTERN, '[REDACTED_PATH]');

  // 5. Mask internal IP addresses
  sanitized = sanitized.replace(INTERNAL_IP_PATTERN, '[REDACTED_IP]');

  return sanitized.trim();
}
