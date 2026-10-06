import { describe, expect, it } from 'vitest';
import { SandboxSecurityViolationError, SsrfGuard } from '../../src/domain/index.js';

describe('SSRF Guard', () => {
  it('blocks loopback and localhost addresses', () => {
    expect(() => SsrfGuard.validateUrl('http://localhost:8080')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() => SsrfGuard.validateUrl('http://127.0.0.1:3000/api')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() => SsrfGuard.validateUrl('http://127.0.1.1/')).toThrow(SandboxSecurityViolationError);
  });

  it('blocks private RFC-1918 subnets', () => {
    expect(() => SsrfGuard.validateUrl('http://10.0.0.5/secrets')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() => SsrfGuard.validateUrl('http://172.16.0.1/data')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() => SsrfGuard.validateUrl('http://172.31.255.254/data')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() => SsrfGuard.validateUrl('http://192.168.1.1/admin')).toThrow(
      SandboxSecurityViolationError,
    );
  });

  it('blocks cloud metadata endpoints', () => {
    expect(() => SsrfGuard.validateUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() =>
      SsrfGuard.validateUrl('http://metadata.google.internal/computeMetadata/v1/'),
    ).toThrow(SandboxSecurityViolationError);
  });

  it('blocks internal Kubernetes and corporate service domains', () => {
    expect(() => SsrfGuard.validateUrl('http://database.svc.cluster.local:5432')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() => SsrfGuard.validateUrl('http://auth.internal/keys')).toThrow(
      SandboxSecurityViolationError,
    );
    expect(() => SsrfGuard.validateUrl('http://corp-ldap.corp/')).toThrow(
      SandboxSecurityViolationError,
    );
  });

  it('permits valid public URLs', () => {
    expect(() => SsrfGuard.validateUrl('https://api.github.com/users/octocat')).not.toThrow();
    expect(() => SsrfGuard.validateUrl('https://example.com/data.json')).not.toThrow();
  });
});
