import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@oicunt-ai/model-types': resolve(import.meta.dirname, 'packages/model-types/src/index.ts'),
      '@oicunt-ai/ai-types': resolve(import.meta.dirname, 'packages/ai-types/src/index.ts'),
      '@oicunt-ai/tool-types': resolve(import.meta.dirname, 'packages/tool-types/src/index.ts'),
      '@oicunt-ai/agent-types': resolve(import.meta.dirname, 'packages/agent-types/src/index.ts'),
      '@oicunt-ai/mcp-types': resolve(import.meta.dirname, 'packages/mcp-types/src/index.ts'),
      '@oicunt-ai/observability': resolve(
        import.meta.dirname,
        'packages/observability/src/index.ts',
      ),
      '@oicunt-ai/service-template': resolve(import.meta.dirname, 'templates/service/src/index.ts'),
      '@oicunt-ai/service-model-registry': resolve(
        import.meta.dirname,
        'services/model-registry/src/index.ts',
      ),
      '@oicunt-ai/service-model-gateway': resolve(
        import.meta.dirname,
        'services/model-gateway/src/index.ts',
      ),
      '@oicunt-ai/service-memory': resolve(import.meta.dirname, 'services/memory/src/index.ts'),
      '@oicunt-ai/service-knowledge': resolve(
        import.meta.dirname,
        'services/knowledge/src/index.ts',
      ),
      '@oicunt-ai/service-embeddings': resolve(
        import.meta.dirname,
        'services/embeddings/src/index.ts',
      ),
      '@oicunt-ai/service-tools': resolve(import.meta.dirname, 'services/tools/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
      'templates/*/tests/**/*.test.ts',
      'services/*/tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
