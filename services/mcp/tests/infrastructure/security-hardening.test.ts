import { describe, expect, it } from 'vitest';
import { McpService } from '../../src/service.js';
import { loadMcpConfig } from '../../src/config.js';
import { McpSecurityError } from '../../src/domain/errors.js';
import {
  InMemorySecretStore,
  validateAuthSecretRef,
  validateTransportHeaders,
  validateStdioCommand,
  validateStdioArgs,
  buildSanitizedEnvironment,
} from '../../src/infrastructure/security/index.js';
import { RegisterServerUseCase } from '../../src/application/use-cases/register-server.use-case.js';
import { InMemoryMcpServerRepository } from '../../src/infrastructure/repositories/in-memory-mcp-server.repository.js';

describe('MCP Production Security Hardening', () => {
  describe('Secret Storage Boundary', () => {
    it('prohibits fallback to in-memory secret store when isProduction is true', () => {
      const prodConfig = loadMcpConfig({
        isProduction: true,
        useDatabase: false,
        logLevel: 'silent',
      });

      expect(() => {
        new McpService({ config: prodConfig });
      }).toThrowError(McpSecurityError);

      expect(() => {
        new McpService({ config: prodConfig });
      }).toThrowError(
        /Production configuration requires an explicit external secret store adapter/,
      );
    });

    it('allows McpService in production when explicit external secret store is provided', () => {
      const prodConfig = loadMcpConfig({
        isProduction: true,
        useDatabase: false,
        logLevel: 'silent',
      });

      const externalSecretStore = new InMemorySecretStore();
      expect(() => {
        new McpService({
          config: prodConfig,
          secretStore: externalSecretStore,
        });
      }).not.toThrow();
    });

    it('rejects raw tokens and bearer strings in authSecretRef', () => {
      expect(() =>
        validateAuthSecretRef('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID'),
      ).toThrowError(McpSecurityError);

      expect(() => validateAuthSecretRef('sk-ant-api03-1234567890abcdef')).toThrowError(
        McpSecurityError,
      );

      expect(() =>
        validateAuthSecretRef('ghp_abcdef1234567890abcdef1234567890abcdef'),
      ).toThrowError(McpSecurityError);

      expect(() =>
        validateAuthSecretRef(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotPersistRawJwt',
        ),
      ).toThrowError(McpSecurityError);

      expect(() => validateAuthSecretRef('token with spaces')).toThrowError(McpSecurityError);

      expect(() => validateAuthSecretRef('a'.repeat(129))).toThrowError(McpSecurityError);
    });

    it('accepts valid opaque secret identifiers in authSecretRef', () => {
      expect(() => validateAuthSecretRef('vault/tenant-42/mcp-github-key')).not.toThrow();
      expect(() => validateAuthSecretRef('sec_prod_database_token')).not.toThrow();
      expect(() => validateAuthSecretRef('aws-sm:oicunt/external-mcp-ref')).not.toThrow();
    });

    it('rejects raw credentials in HTTP transport headers', () => {
      expect(() => {
        validateTransportHeaders({
          Authorization: 'Bearer eyJhbGciOi...',
        });
      }).toThrowError(McpSecurityError);

      expect(() => {
        validateTransportHeaders({
          'x-api-key': 'sk-1234567890',
        });
      }).toThrowError(McpSecurityError);

      expect(() => {
        validateTransportHeaders({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        });
      }).not.toThrow();
    });

    it('prevents persistence of raw tokens during server registration', async () => {
      const repo = new InMemoryMcpServerRepository();
      const useCase = new RegisterServerUseCase(repo);

      await expect(
        useCase.execute({
          tenantId: 'tenant-test',
          name: 'leaky-server',
          transportType: 'streamable_http',
          authSecretRef: 'sk-ant-api03-leak-raw-key-directly',
          transportConfig: {
            type: 'streamable_http',
            config: { url: 'https://api.example.com/mcp' },
          },
        }),
      ).rejects.toThrow(McpSecurityError);

      const saved = await repo.findByName('leaky-server', 'tenant-test');
      expect(saved).toBeNull();
    });
  });

  describe('stdio Execution Security Boundary', () => {
    it('permits approved runtimes and blocks unapproved binaries', () => {
      // Approved runtimes
      expect(() => validateStdioCommand('node')).not.toThrow();
      expect(() => validateStdioCommand('npx')).not.toThrow();
      expect(() => validateStdioCommand('python')).not.toThrow();
      expect(() => validateStdioCommand('python3')).not.toThrow();
      expect(() => validateStdioCommand('uvx')).not.toThrow();
      expect(() => validateStdioCommand('bun')).not.toThrow();
      expect(() => validateStdioCommand('deno')).not.toThrow();
      expect(() => validateStdioCommand(process.execPath)).not.toThrow();

      // Prohibited binaries
      expect(() => validateStdioCommand('/bin/bash')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('bash')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('sh')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('curl')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('powershell.exe')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('cmd.exe')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('nc')).toThrowError(McpSecurityError);
    });

    it('blocks shell metacharacters and command chaining in stdio command', () => {
      expect(() => validateStdioCommand('node; rm -rf /')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('node && cat /etc/passwd')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('node | sh')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('node `id`')).toThrowError(McpSecurityError);
      expect(() => validateStdioCommand('node $(whoami)')).toThrowError(McpSecurityError);
    });

    it('rejects null bytes in stdio arguments', () => {
      expect(() => validateStdioArgs(['arg1', 'arg2\0malicious'])).toThrowError(McpSecurityError);
      expect(() => validateStdioArgs(['valid1', 'valid2'])).not.toThrow();
    });

    it('blocks registration of unapproved stdio executables', async () => {
      const repo = new InMemoryMcpServerRepository();
      const useCase = new RegisterServerUseCase(repo);

      await expect(
        useCase.execute({
          tenantId: 'tenant-test',
          name: 'arbitrary-exec',
          transportType: 'stdio',
          transportConfig: {
            type: 'stdio',
            config: { command: '/bin/sh', args: ['-c', 'id'] },
          },
        }),
      ).rejects.toThrow(McpSecurityError);
    });

    it('sanitizes environment to prevent parent process secret leakage', () => {
      // Temporarily inject secret-like environment variables in current process
      process.env.INTERNAL_SERVICE_TOKEN = 'super-secret-token-123';
      process.env.DATABASE_PASSWORD = 'super-secret-db-pass';
      process.env.TEST_API_KEY = 'secret-api-key';

      try {
        const sanitized = buildSanitizedEnvironment({
          SAFE_PARAM: 'hello-world',
        });

        expect(sanitized.INTERNAL_SERVICE_TOKEN).toBeUndefined();
        expect(sanitized.DATABASE_PASSWORD).toBeUndefined();
        expect(sanitized.TEST_API_KEY).toBeUndefined();
        expect(sanitized.SAFE_PARAM).toBe('hello-world');
        expect(sanitized.PATH || sanitized.Path).toBeDefined();
      } finally {
        delete process.env.INTERNAL_SERVICE_TOKEN;
        delete process.env.DATABASE_PASSWORD;
        delete process.env.TEST_API_KEY;
      }
    });

    it('prohibits dangerous loader and process hijacking variables in customEnv', () => {
      expect(() => buildSanitizedEnvironment({ LD_PRELOAD: '/malicious.so' })).toThrowError(
        McpSecurityError,
      );

      expect(() => buildSanitizedEnvironment({ NODE_OPTIONS: '--inspect=0.0.0.0' })).toThrowError(
        McpSecurityError,
      );

      expect(() => buildSanitizedEnvironment({ PYTHONPATH: '/injected/path' })).toThrowError(
        McpSecurityError,
      );

      expect(() => buildSanitizedEnvironment({ MY_DATABASE_PASSWORD: 'leak' })).toThrowError(
        McpSecurityError,
      );
    });
  });
});
