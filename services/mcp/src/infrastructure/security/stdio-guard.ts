import { basename } from 'node:path';
import { McpSecurityError } from '../../domain/errors.js';

export const DEFAULT_ALLOWED_STDIO_EXECUTABLES: readonly string[] = Object.freeze([
  'node',
  'npx',
  'python',
  'python3',
  'uvx',
  'uv',
  'deno',
  'bun',
]);

const FORBIDDEN_SHELL_PATTERNS = /[;&|`$<>]/;

const DANGEROUS_ENV_VARS = new Set([
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PYTHONHOME',
  'RUBYOPT',
  'PERL5OPT',
]);

const SENSITIVE_ENV_SUBSTRINGS = [
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'KEY',
  'AUTH',
  'CREDENTIAL',
  'PRIVATE',
  'DATABASE',
  'DB_',
  'POSTGRES',
  'PG_',
  'API_KEY',
];

const SAFE_SYSTEM_ENV_VARS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'USER',
  'USERNAME',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
];

/**
 * Validates that an executable command is strictly within the approved runtime allowlist
 * and contains no shell metacharacters or arbitrary path breakouts.
 */
export function validateStdioCommand(
  command: string,
  allowedExecutables: readonly string[] = DEFAULT_ALLOWED_STDIO_EXECUTABLES,
): void {
  if (!command || typeof command !== 'string' || !command.trim()) {
    throw new McpSecurityError('Command is required for stdio transport');
  }

  const trimmed = command.trim();

  if (FORBIDDEN_SHELL_PATTERNS.test(trimmed)) {
    throw new McpSecurityError(
      'Command contains forbidden shell metacharacters. Direct shell chaining is prohibited.',
    );
  }

  // Extract base executable name (handles both relative/absolute paths and extensions)
  const execBase = basename(trimmed)
    .toLowerCase()
    .replace(/\.exe$/i, '');
  const currentProcessBase = basename(process.execPath)
    .toLowerCase()
    .replace(/\.exe$/i, '');

  const normalizedAllowed = new Set(allowedExecutables.map((e) => e.toLowerCase()));
  normalizedAllowed.add(currentProcessBase);

  if (!normalizedAllowed.has(execBase)) {
    throw new McpSecurityError(
      `Executable '${trimmed}' (${execBase}) is not permitted. Only approved runtimes are allowed: ${[...normalizedAllowed].join(', ')}`,
    );
  }
}

/**
 * Validates stdio command arguments for null-byte or shell injection safety.
 */
export function validateStdioArgs(args?: readonly string[]): void {
  if (!args) return;

  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new McpSecurityError('All stdio arguments must be strings');
    }
    if (arg.includes('\0')) {
      throw new McpSecurityError('Stdio arguments must not contain null bytes');
    }
  }
}

/**
 * Constructs a secure, isolated environment for child process execution.
 * Restricts environment inheritance and prevents host secret leakage.
 */
export function buildSanitizedEnvironment(
  customEnv?: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  // 1. Copy only safe system baseline variables from host process
  for (const varName of SAFE_SYSTEM_ENV_VARS) {
    const val = process.env[varName];
    if (val !== undefined) {
      // Ensure it does not contain secret substrings
      const upper = varName.toUpperCase();
      if (!SENSITIVE_ENV_SUBSTRINGS.some((s) => upper.includes(s))) {
        sanitized[varName] = val;
      }
    }
  }

  // 2. Validate and apply caller-supplied custom environment variables
  if (customEnv) {
    for (const [key, val] of Object.entries(customEnv)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new McpSecurityError(`Invalid environment variable name '${key}'`);
      }

      const upper = key.toUpperCase();
      if (DANGEROUS_ENV_VARS.has(upper)) {
        throw new McpSecurityError(
          `Environment variable '${key}' is prohibited due to process execution hijacking risks`,
        );
      }

      if (SENSITIVE_ENV_SUBSTRINGS.some((s) => upper.includes(s))) {
        throw new McpSecurityError(
          `Environment variable '${key}' is prohibited to prevent credential shadowing or leakage`,
        );
      }

      if (typeof val === 'string') {
        sanitized[key] = val;
      }
    }
  }

  return sanitized;
}
