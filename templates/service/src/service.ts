import { createServer, type Server } from 'node:http';
import { loadAiServiceConfig, type AiServiceConfig } from './config.js';
import { createHttpRouter } from './interfaces/index.js';

export interface ServiceDependencies {
  readonly config?: AiServiceConfig | undefined;
}

export class ServiceInstance {
  private readonly config: AiServiceConfig;
  private server: Server | null = null;
  private ready = false;

  constructor(dependencies: ServiceDependencies = {}) {
    this.config = dependencies.config ?? loadAiServiceConfig();
  }

  getConfig(): AiServiceConfig {
    return this.config;
  }

  isReady(): boolean {
    return this.ready;
  }

  async initialize(): Promise<void> {
    const router = createHttpRouter({
      serviceName: this.config.serviceName,
      version: this.config.version,
      isReady: () => this.ready,
    });

    this.server = createServer((req, res) => {
      void router(req, res);
    });

    this.ready = true;
  }

  async start(): Promise<number> {
    if (!this.server) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialized'));
        return;
      }

      this.server.listen(this.config.port, this.config.host, () => {
        const address = this.server?.address();
        const actualPort =
          typeof address === 'object' && address !== null ? address.port : this.config.port;
        resolve(actualPort);
      });

      this.server.on('error', (err) => {
        this.ready = false;
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    this.ready = false;

    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve();
      }, this.config.shutdownTimeoutMs);

      this.server?.close((err) => {
        clearTimeout(timeout);
        this.server = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
