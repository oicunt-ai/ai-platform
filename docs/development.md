# OICUNT AI Platform Development Guide

This guide details local environment setup, monorepo workflows, development standards, and contribution processes for the **OICUNT AI Platform**.

---

## 1. Prerequisites & Environment Setup

Ensure the following runtimes and tools are installed:

- **Node.js**: `22.x` (Active LTS) or `>=20.0.0`
- **pnpm**: `12.x` or `>=9.0.0` (Corepack or standalone install: `npm install -g pnpm@12.9.1`)
- **Git**: `2.40+`

Verify installations:

```bash
node -v    # Expected: v22.x or >=v20.0.0
pnpm -v    # Expected: >=9.0.0
git --version
```

---

## 2. Quickstart & Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/oicunt-ai/ai-platform.git
cd ai-platform

# Install dependencies (respecting pnpm-lock.yaml)
pnpm install

# Verify the foundation
pnpm verify
```

---

## 3. Monorepo Scripts Reference

All primary commands are executed from the monorepo root:

| Command             | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `pnpm install`      | Installs dependencies across all workspaces                                            |
| `pnpm build`        | Compiles TypeScript packages using project references (`tsc -b`)                       |
| `pnpm clean`        | Cleans all `dist/`, `coverage/`, and `.tsbuildinfo` artifacts                          |
| `pnpm format`       | Formats all files with Prettier                                                        |
| `pnpm format:check` | Checks that all files conform to Prettier formatting                                   |
| `pnpm lint`         | Runs ESLint across all files                                                           |
| `pnpm lint:fix`     | Runs ESLint with automated fixes                                                       |
| `pnpm type-check`   | Type-checks all packages and tests (`tsc -p tsconfig.typecheck.json`)                  |
| `pnpm test`         | Runs the Vitest test suite once                                                        |
| `pnpm test:watch`   | Runs Vitest in interactive watch mode                                                  |
| `pnpm verify`       | Executes the complete local verification suite (format, lint, build, type-check, test) |

---

## 4. Package Structure & TypeScript Project References

Every package under `packages/` must adhere to the standard workspace layout:

```
packages/<package-name>/
├── package.json        # Workspace configuration, exports, scripts
├── tsconfig.json       # Extends ../../tsconfig.base.json with rootDir & outDir
├── README.md           # Package purpose, boundary, and export inventory
└── src/
    ├── index.ts        # Primary package exports & types
    └── index.test.ts   # Unit test verifying exports
```

### TypeScript Project References

Packages utilize TypeScript Project References (`composite: true`) to ensure fast, incremental, and type-safe builds.

When package `B` depends on package `A`:

1. In `packages/B/package.json`:
   ```json
   "dependencies": {
     "@oicunt-ai/A": "workspace:*"
   }
   ```
2. In `packages/B/tsconfig.json`:
   ```json
   "references": [
     { "path": "../A" }
   ]
   ```
3. In root `tsconfig.json`:
   Ensure both `packages/A` and `packages/B` are registered in the root `references` list.

---

## 5. Coding & Linting Standards

- **Strict Mode**: TypeScript strict mode is enabled unconditionally (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **No Direct Vendor Types**: Never leak vendor SDK types into shared packages or orchestrators.
- **Naming Conventions**:
  - Types/Interfaces: PascalCase (e.g. `NormalizedCompletionRequest`, `TokenUsage`)
  - Variables/Functions: camelCase (e.g. `recordTokenUsage`, `startSpan`)
  - Enums/Constants: UPPER_SNAKE_CASE (e.g. `MCP_LATEST_PROTOCOL_VERSION`)
  - Directories/Files: kebab-case (e.g. `model-types`, `foundation.test.ts`)

---

## 6. Testing Guidelines

- Tests use **Vitest** configured with root path resolution.
- Unit tests (`*.test.ts`) must remain pure in-memory tests with zero disk or network I/O.
- Test files are placed adjacent to source files (`src/index.test.ts`) or in the root `tests/` directory for cross-package integration tests.
- Run tests continuously during development:
  ```bash
  pnpm test:watch
  ```

---

## 7. Pre-Commit & PR Verification

Before submitting a Pull Request, run the full verification suite:

```bash
pnpm verify
```

This ensures format checks, linting, build outputs, type checking, and tests pass with zero warnings and zero errors.
