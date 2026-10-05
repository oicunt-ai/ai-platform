import type { AdapterRegistryPort, IProviderAdapter } from '../../application/ports/index.js';

export class InMemoryAdapterRegistry implements AdapterRegistryPort {
  private readonly adapters = new Map<string, IProviderAdapter>();

  constructor(initialAdapters: readonly IProviderAdapter[] = []) {
    for (const adapter of initialAdapters) {
      this.register(adapter);
    }
  }

  public getAdapter(provider: string): IProviderAdapter | undefined {
    return this.adapters.get(provider.toLowerCase());
  }

  public register(adapter: IProviderAdapter): void {
    this.adapters.set(adapter.provider.toLowerCase(), adapter);
  }

  public getAllAdapters(): readonly IProviderAdapter[] {
    return Array.from(this.adapters.values());
  }
}
