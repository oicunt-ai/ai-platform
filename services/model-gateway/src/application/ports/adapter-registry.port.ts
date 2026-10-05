import type { IProviderAdapter } from './provider-adapter.port.js';

export interface AdapterRegistryPort {
  getAdapter(provider: string): IProviderAdapter | undefined;
  register(adapter: IProviderAdapter): void;
  getAllAdapters(): readonly IProviderAdapter[];
}
