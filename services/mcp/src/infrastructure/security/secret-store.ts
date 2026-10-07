import type { SecretStorePort } from '../../application/ports/secret-store.port.js';

export class InMemorySecretStore implements SecretStorePort {
  private readonly secrets = new Map<string, string>();

  private makeKey(secretRef: string, tenantId: string): string {
    return `${tenantId}::${secretRef}`;
  }

  public setSecret(secretRef: string, tenantId: string, secretValue: string): void {
    this.secrets.set(this.makeKey(secretRef, tenantId), secretValue);
  }

  public async getSecret(secretRef: string, tenantId: string): Promise<string | null> {
    const key = this.makeKey(secretRef, tenantId);
    if (this.secrets.has(key)) {
      return this.secrets.get(key)!;
    }
    // Fall back to environment variable if matches pattern
    const envVal = process.env[secretRef];
    if (envVal) {
      return envVal;
    }
    return null;
  }

  public clear(): void {
    this.secrets.clear();
  }
}
