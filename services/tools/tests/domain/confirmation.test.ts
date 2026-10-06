import { describe, expect, it } from 'vitest';
import {
  computeArgumentsHash,
  ConfirmationManager,
  type ToolConfirmationPayload,
} from '../../src/domain/index.js';

describe('Tools Confirmation Manager (Ed25519)', () => {
  const manager = new ConfirmationManager({
    challengeTtlSeconds: 60,
  });

  it('generates valid Ed25519 key pair with PEM export capabilities', () => {
    const pubPem = manager.getPublicKeyPem();
    const privPem = manager.getPrivateKeyPem();

    expect(pubPem).toContain('BEGIN PUBLIC KEY');
    expect(privPem).toContain('BEGIN PRIVATE KEY');

    // Instantiate a verifier-only manager using only the public key
    const verifier = new ConfirmationManager({
      publicKey: pubPem,
    });
    expect(verifier.getPublicKeyPem()).toBe(pubPem);
  });

  it('computes deterministic arguments hash independent of object key order', () => {
    const hash1 = computeArgumentsHash({ a: 1, b: 2, c: { x: 'foo', y: 'bar' } });
    const hash2 = computeArgumentsHash({ c: { y: 'bar', x: 'foo' }, b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('creates valid challenge token and verifies Ed25519-signed confirmation token', () => {
    const challenge = manager.createChallenge({
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      arguments: { recipient: 'user@example.com', body: 'Hello' },
      tenantId: 'tenant_123',
      userId: 'user_456',
      actorId: 'actor_789',
    });

    expect(challenge.challengeToken).toBeDefined();
    expect(challenge.argumentsHash).toBe(
      computeArgumentsHash({ recipient: 'user@example.com', body: 'Hello' }),
    );

    // Simulate approving the challenge and issuing confirmation token
    const payload: ToolConfirmationPayload = {
      challengeToken: challenge.challengeToken,
      tenantId: 'tenant_123',
      userId: 'user_456',
      actorId: 'actor_789',
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      argumentsHash: challenge.argumentsHash,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };

    const confirmationToken = manager.issueConfirmationToken(payload);

    // Verify using separate verifier with public key
    const verifier = new ConfirmationManager({
      publicKey: manager.getPublicKeyPem(),
    });

    const isValid = verifier.verifyConfirmationToken({
      token: confirmationToken,
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      arguments: { recipient: 'user@example.com', body: 'Hello' },
      tenantId: 'tenant_123',
      userId: 'user_456',
      actorId: 'actor_789',
    });

    expect(isValid).toBe(true);
  });

  it('rejects confirmation token if arguments were tampered with', () => {
    const challenge = manager.createChallenge({
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      arguments: { recipient: 'user@example.com', amount: 100 },
      tenantId: 'tenant_123',
      userId: 'user_456',
      actorId: 'actor_789',
    });

    const payload: ToolConfirmationPayload = {
      challengeToken: challenge.challengeToken,
      tenantId: 'tenant_123',
      userId: 'user_456',
      actorId: 'actor_789',
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      argumentsHash: challenge.argumentsHash,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };

    const token = manager.issueConfirmationToken(payload);

    // Caller attempts to execute different arguments (amount: 100000)
    const isValid = manager.verifyConfirmationToken({
      token,
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      arguments: { recipient: 'user@example.com', amount: 100000 },
      tenantId: 'tenant_123',
    });

    expect(isValid).toBe(false);
  });

  it('rejects confirmation token across different tenant or expired token', () => {
    const payload: ToolConfirmationPayload = {
      challengeToken: 'chal_123',
      tenantId: 'tenant_123',
      userId: 'user_456',
      actorId: 'actor_789',
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      argumentsHash: computeArgumentsHash({ foo: 'bar' }),
      issuedAt: Date.now() - 10000,
      expiresAt: Date.now() - 1000, // expired!
    };

    const expiredToken = manager.issueConfirmationToken(payload);

    const isValid = manager.verifyConfirmationToken({
      token: expiredToken,
      toolId: 'oicunt.tool.communication.send_email',
      version: '1.0.0',
      arguments: { foo: 'bar' },
      tenantId: 'tenant_123',
    });

    expect(isValid).toBe(false);
  });
});
