import { describe, expect, it } from 'vitest';
import { StdioTransport } from '../../src/infrastructure/transports/stdio-transport.js';
import { McpSecurityError } from '../../src/domain/errors.js';

describe('StdioTransport', () => {
  it('rejects commands containing shell metacharacters', () => {
    expect(() => new StdioTransport({ command: 'node; rm -rf /' })).toThrow(McpSecurityError);
    expect(() => new StdioTransport({ command: 'bash | cat' })).toThrow(McpSecurityError);
    expect(() => new StdioTransport({ command: 'python && whoami' })).toThrow(McpSecurityError);
    expect(() => new StdioTransport({ command: 'cat `id`' })).toThrow(McpSecurityError);
    expect(() => new StdioTransport({ command: 'echo $PATH' })).toThrow(McpSecurityError);
  });

  it('runs supervised child process and exchanges JSON-RPC messages', async () => {
    // Run an echo script using node -e
    const echoScript = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        try {
          const req = JSON.parse(line);
          const res = { jsonrpc: '2.0', id: req.id, result: { echo: req.params } };
          process.stdout.write(JSON.stringify(res) + '\\n');
        } catch {}
      });
    `;

    const transport = new StdioTransport({
      command: process.execPath,
      args: ['-e', echoScript],
    });

    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    const result = await transport.sendRequest<{ echo: { msg: string } }>('ping', {
      msg: 'hello-stdio',
    });
    expect(result).toEqual({ echo: { msg: 'hello-stdio' } });

    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });
});
