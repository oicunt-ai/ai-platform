import { describe, expect, it } from 'vitest';
import { SsrfGuard } from '../../src/infrastructure/security/ssrf-guard.js';
import { McpSecurityError } from '../../src/domain/errors.js';

describe('SsrfGuard', () => {
  it('blocks loopback IP addresses (127.0.0.1, ::1)', () => {
    expect(SsrfGuard.isIpProhibited('127.0.0.1')).toBe(true);
    expect(SsrfGuard.isIpProhibited('127.255.255.255')).toBe(true);
    expect(SsrfGuard.isIpProhibited('::1')).toBe(true);
  });

  it('blocks RFC 1918 private subnets', () => {
    expect(SsrfGuard.isIpProhibited('10.0.0.1')).toBe(true);
    expect(SsrfGuard.isIpProhibited('172.16.0.1')).toBe(true);
    expect(SsrfGuard.isIpProhibited('172.31.255.255')).toBe(true);
    expect(SsrfGuard.isIpProhibited('192.168.1.1')).toBe(true);
  });

  it('blocks cloud metadata endpoint and link-local addresses', () => {
    expect(SsrfGuard.isIpProhibited('169.254.169.254')).toBe(true);
    expect(SsrfGuard.isIpProhibited('169.254.1.1')).toBe(true);
    expect(SsrfGuard.isIpProhibited('fe80::1')).toBe(true);
  });

  it('allows public IP addresses', () => {
    expect(SsrfGuard.isIpProhibited('8.8.8.8')).toBe(false);
    expect(SsrfGuard.isIpProhibited('1.1.1.1')).toBe(false);
    expect(SsrfGuard.isIpProhibited('104.244.42.1')).toBe(false);
  });

  it('validates safe URLs and throws on prohibited targets', () => {
    expect(() => SsrfGuard.validateUrl('http://169.254.169.254/latest/meta-data')).toThrow(
      McpSecurityError,
    );
    expect(() => SsrfGuard.validateUrl('http://localhost:8080/mcp')).toThrow(McpSecurityError);
    expect(() => SsrfGuard.validateUrl('http://metadata.google.internal')).toThrow(
      McpSecurityError,
    );
    expect(() => SsrfGuard.validateUrl('file:///etc/passwd')).toThrow(McpSecurityError);

    const safe = SsrfGuard.validateUrl('https://api.example.com/mcp');
    expect(safe.hostname).toBe('api.example.com');
  });
});
