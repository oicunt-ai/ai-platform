import { describe, expect, it } from 'vitest';
import {
  buildCanonicalToolId,
  parseCanonicalToolId,
  sanitizeIdentifier,
} from '../../src/domain/values/identity.js';

describe('Identity Values', () => {
  describe('sanitizeIdentifier', () => {
    it('normalizes uppercase and special characters to lowercase and underscores', () => {
      expect(sanitizeIdentifier('My Server!@#')).toBe('my_server___');
      expect(sanitizeIdentifier('  Postgres-DB  ')).toBe('postgres-db');
    });
  });

  describe('buildCanonicalToolId', () => {
    it('creates deterministic tool ID according to oicunt.tool.mcp.<server_id>.<tool_name>', () => {
      const toolId = buildCanonicalToolId('github_srv', 'create_issue');
      expect(toolId).toBe('oicunt.tool.mcp.github_srv.create_issue');
    });

    it('sanitizes server ID and tool name characters', () => {
      const toolId = buildCanonicalToolId('My Server', 'Get User Info!');
      expect(toolId).toBe('oicunt.tool.mcp.my_server.get_user_info_');
    });
  });

  describe('parseCanonicalToolId', () => {
    it('parses valid MCP canonical tool IDs', () => {
      const parsed = parseCanonicalToolId('oicunt.tool.mcp.github_srv.create_issue');
      expect(parsed).toEqual({
        serverId: 'github_srv',
        toolName: 'create_issue',
      });
    });

    it('parses tool IDs with nested dot delimiters', () => {
      const parsed = parseCanonicalToolId('oicunt.tool.mcp.my_server.tools.query.v1');
      expect(parsed).toEqual({
        serverId: 'my_server',
        toolName: 'tools.query.v1',
      });
    });

    it('returns null for non-MCP canonical tool IDs', () => {
      expect(parseCanonicalToolId('oicunt.tool.internal.math.add')).toBeNull();
      expect(parseCanonicalToolId('invalid_id')).toBeNull();
      expect(parseCanonicalToolId('oicunt.tool.mcp.incomplete')).toBeNull();
    });
  });
});
