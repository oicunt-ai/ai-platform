export interface KeyValueStorePort<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export class InMemoryKeyValueStore<T> implements KeyValueStorePort<T> {
  private readonly store = new Map<string, T>();

  async get(key: string): Promise<T | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
