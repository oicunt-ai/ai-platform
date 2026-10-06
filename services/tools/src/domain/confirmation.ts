import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import type { ToolConfirmationChallenge, ToolConfirmationPayload, ToolId } from './types.js';

export function computeArgumentsHash(args: Record<string, unknown>): string {
  // Deterministic canonical JSON key ordering
  const canonicalString = serializeCanonicalJson(args);
  return createHash('sha256').update(canonicalString).digest('hex');
}

function serializeCanonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(serializeCanonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${serializeCanonicalJson((obj as Record<string, unknown>)[key])}`,
  );
  return '{' + entries.join(',') + '}';
}

export interface ConfirmationManagerOptions {
  /**
   * Optional Ed25519 private key (PEM string or KeyObject).
   * If omitted, a fresh Ed25519 keypair is generated.
   */
  readonly privateKey?: KeyObject | string | undefined;

  /**
   * Optional Ed25519 public key (PEM string or KeyObject).
   * Inferred from private key if omitted.
   */
  readonly publicKey?: KeyObject | string | undefined;

  /** Challenge time-to-live in seconds (default: 300s). */
  readonly challengeTtlSeconds?: number | undefined;
}

export class ConfirmationManager {
  private readonly privateKey: KeyObject | null;
  private readonly publicKey: KeyObject;
  private readonly challengeTtlSeconds: number;

  constructor(options: ConfirmationManagerOptions = {}) {
    this.challengeTtlSeconds = options.challengeTtlSeconds ?? 300; // 5 minutes

    if (options.privateKey) {
      this.privateKey =
        typeof options.privateKey === 'string'
          ? createPrivateKey(options.privateKey)
          : options.privateKey;
      this.publicKey = options.publicKey
        ? typeof options.publicKey === 'string'
          ? createPublicKey(options.publicKey)
          : options.publicKey
        : createPublicKey(this.privateKey);
    } else if (options.publicKey) {
      this.privateKey = null;
      this.publicKey =
        typeof options.publicKey === 'string'
          ? createPublicKey(options.publicKey)
          : options.publicKey;
    } else {
      const generated = generateKeyPairSync('ed25519');
      this.privateKey = generated.privateKey;
      this.publicKey = generated.publicKey;
    }
  }

  public getPublicKeyPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  public getPrivateKeyPem(): string {
    if (!this.privateKey) {
      throw new Error('No private key configured on this ConfirmationManager instance');
    }
    return this.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  public createChallenge(params: {
    readonly toolId: ToolId;
    readonly version: string;
    readonly arguments: Record<string, unknown>;
    readonly tenantId: string;
    readonly userId: string;
    readonly actorId: string;
  }): ToolConfirmationChallenge {
    const argumentsHash = computeArgumentsHash(params.arguments);
    const expiresAt = new Date(Date.now() + this.challengeTtlSeconds * 1000).toISOString();
    const challengeId = randomBytes(16).toString('hex');

    const payload = {
      challengeId,
      toolId: params.toolId,
      version: params.version,
      argumentsHash,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId,
      expiresAt,
    };

    const serializedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(serializedPayload);
    const challengeToken = `${serializedPayload}.${signature}`;

    return {
      challengeToken,
      toolId: params.toolId,
      version: params.version,
      argumentsHash,
      expiresAt,
    };
  }

  public issueConfirmationToken(payload: ToolConfirmationPayload): string {
    const serializedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(serializedPayload);
    return `${serializedPayload}.${signature}`;
  }

  public verifyConfirmationToken(params: {
    readonly token: string;
    readonly toolId: ToolId;
    readonly version: string;
    readonly arguments: Record<string, unknown>;
    readonly tenantId: string;
    readonly userId?: string | undefined;
    readonly actorId?: string | undefined;
  }): boolean {
    const parts = params.token.split('.');
    if (parts.length !== 2) {
      return false;
    }

    const [payloadB64, signature] = parts;
    if (!payloadB64 || !signature) {
      return false;
    }

    if (!this.verifySignature(payloadB64, signature)) {
      return false;
    }

    let decoded: Record<string, unknown>;
    try {
      decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as Record<
        string,
        unknown
      >;
    } catch {
      return false;
    }

    // Check expiration
    const expiresAt =
      typeof decoded['expiresAt'] === 'number'
        ? decoded['expiresAt']
        : typeof decoded['expiresAt'] === 'string'
          ? new Date(decoded['expiresAt']).getTime()
          : 0;

    if (Date.now() > expiresAt) {
      return false;
    }

    // Check tenant isolation
    if (decoded['tenantId'] !== params.tenantId) {
      return false;
    }

    // Check tool ID
    if (decoded['toolId'] !== params.toolId) {
      return false;
    }

    // Check version if present
    if (decoded['version'] && decoded['version'] !== params.version) {
      return false;
    }

    // Check arguments hash
    const currentArgsHash = computeArgumentsHash(params.arguments);
    if (decoded['argumentsHash'] !== currentArgsHash) {
      return false;
    }

    return true;
  }

  private sign(data: string): string {
    if (!this.privateKey) {
      throw new Error('No private key configured on this ConfirmationManager instance for signing');
    }
    return sign(null, Buffer.from(data, 'utf-8'), this.privateKey).toString('base64url');
  }

  private verifySignature(data: string, signatureB64: string): boolean {
    try {
      return verify(
        null,
        Buffer.from(data, 'utf-8'),
        this.publicKey,
        Buffer.from(signatureB64, 'base64url'),
      );
    } catch {
      return false;
    }
  }
}
