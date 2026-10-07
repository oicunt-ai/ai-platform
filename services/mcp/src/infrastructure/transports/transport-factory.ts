import type {
  McpTransportFactoryPort,
  McpTransportPort,
} from '../../application/ports/mcp-transport.port.js';
import type { McpServerRegistration } from '../../domain/types.js';
import { McpInvalidRequestError } from '../../domain/errors.js';
import { StreamableHttpTransport } from './streamable-http-transport.js';
import { StdioTransport } from './stdio-transport.js';
import { LegacySseTransport } from './legacy-sse-transport.js';

export class TransportFactory implements McpTransportFactoryPort {
  constructor(
    private readonly allowLocalhost = false,
    private readonly allowedStdioExecutables?: readonly string[] | undefined,
  ) {}

  public async createTransport(
    registration: McpServerRegistration,
    resolvedSecret?: string | undefined,
  ): Promise<McpTransportPort> {
    switch (registration.transportType) {
      case 'streamable_http': {
        if (registration.transportConfig.type !== 'streamable_http') {
          throw new McpInvalidRequestError('Mismatched transportConfig for streamable_http');
        }
        return new StreamableHttpTransport(
          registration.transportConfig.config,
          resolvedSecret,
          this.allowLocalhost,
        );
      }
      case 'stdio': {
        if (registration.transportConfig.type !== 'stdio') {
          throw new McpInvalidRequestError('Mismatched transportConfig for stdio');
        }
        return new StdioTransport(
          registration.transportConfig.config,
          this.allowedStdioExecutables,
        );
      }
      case 'sse': {
        if (registration.transportConfig.type !== 'sse') {
          throw new McpInvalidRequestError('Mismatched transportConfig for sse');
        }
        return new LegacySseTransport(
          registration.transportConfig.config,
          resolvedSecret,
          this.allowLocalhost,
        );
      }
      default:
        throw new McpInvalidRequestError(
          `Unsupported transport type '${(registration as any).transportType}'`,
        );
    }
  }
}
