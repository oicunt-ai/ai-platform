export interface SecretStorePort {
  getSecret(secretRef: string, tenantId: string): Promise<string | null>;
}
