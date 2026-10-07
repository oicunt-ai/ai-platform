import { describe, expect, it } from 'vitest';
import { sanitizeErrorMessage } from '../../src/infrastructure/security/error-sanitizer.js';

describe('sanitizeErrorMessage', () => {
  it('returns default message for empty or non-string input', () => {
    expect(sanitizeErrorMessage('')).toBe('An internal error occurred during tool execution');
    expect(sanitizeErrorMessage(null as any)).toBe(
      'An internal error occurred during tool execution',
    );
  });

  it('keeps benign error messages intact', () => {
    const benign = 'Invalid parameter: amount must be positive';
    expect(sanitizeErrorMessage(benign)).toBe(benign);
  });

  it('strips multiline stack traces', () => {
    const withStack =
      'Validation error: invalid currency\n    at Object.validate (/src/app.ts:25:5)\n    at processTicks';
    expect(sanitizeErrorMessage(withStack)).toBe('Validation error: invalid currency');
  });

  it('redacts internal database errors', () => {
    expect(sanitizeErrorMessage('relation "users" does not exist in database "oicunt_prod"')).toBe(
      'Internal database operation failed',
    );
    expect(sanitizeErrorMessage('syntax error at or near "DROP"')).toBe(
      'Internal database operation failed',
    );
    expect(sanitizeErrorMessage('select * from secret_keys where id = 1')).toBe(
      'Internal database operation failed',
    );
  });

  it('redacts credentials and bearer tokens', () => {
    const raw = 'Failed to connect using Bearer eyJhbGciOiJIUzI1NiJ9.test.sig to provider';
    expect(sanitizeErrorMessage(raw)).toBe(
      'Failed to connect using [REDACTED_CREDENTIAL] to provider',
    );

    const withApiKey = 'Error with sk-ant-api03-1234567890abcdef when calling vendor';
    expect(sanitizeErrorMessage(withApiKey)).toBe(
      'Error with [REDACTED_CREDENTIAL] when calling vendor',
    );
  });

  it('redacts filesystem paths', () => {
    const winPath = 'Could not load script at C:\\internal\\secrets\\key.pem';
    expect(sanitizeErrorMessage(winPath)).toBe('Could not load script at [REDACTED_PATH]');

    const nixPath = 'Could not load script at /etc/ssl/certs/ca.pem';
    expect(sanitizeErrorMessage(nixPath)).toBe('Could not load script at [REDACTED_PATH]');
  });

  it('redacts internal IP addresses and localhost', () => {
    const ipMsg = 'Connection refused at 10.0.4.15 and 192.168.1.100 and localhost:8080';
    const sanitized = sanitizeErrorMessage(ipMsg);
    expect(sanitized).not.toContain('10.0.4.15');
    expect(sanitized).not.toContain('192.168.1.100');
    expect(sanitized).not.toContain('localhost');
  });
});
