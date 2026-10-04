import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();

const targetDirs = [
  'dist',
  'coverage',
  'packages/model-types/dist',
  'packages/ai-types/dist',
  'packages/tool-types/dist',
  'packages/agent-types/dist',
  'packages/mcp-types/dist',
  'packages/observability/dist',
  'templates/service/dist',
];

for (const target of targetDirs) {
  const fullPath = resolve(rootDir, target);
  if (existsSync(fullPath)) {
    console.log(`Cleaning ${target}...`);
    rmSync(fullPath, { recursive: true, force: true });
  }
}

console.log('Clean complete.');
