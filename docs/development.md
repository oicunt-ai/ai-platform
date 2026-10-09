# OICUNT AI Platform Development Guide

This guide details local environment setup, monorepo workflows, development standards, and service implementation conventions for the **OICUNT AI Platform**.

---

## 1. Prerequisites & Environment Setup

Ensure the following runtimes and tools are installed:

- **Node.js**: `22.x` (Active LTS) or `>=20.0.0`
- **pnpm**: `12.x` or `>=9.0.0` (Install via Corepack or `npm install -g pnpm@12.9.1`)
- **Git**: `2.40+`

Verify your local installation:

```bash
node -v    # Expected: v22.x or >=v20.0.0
pnpm -v    # Expected: >=9.0.0
git --version
```

---

## 2. Quickstart & Local Verification

Clone the repository and install all dependencies:

```bash
git clone https://github.com/oicunt-ai/ai-platform.git
cd ai-platform

# Install workspace dependencies (respecting pnpm-lock.yaml)
pnpm install

# Run the full verification suite
pnpm verify
```

---

## 3. Monorepo Scripts Reference

All primary commands are run from the monorepo root:

| Command             | Description                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `pnpm install`      | Installs dependencies across all workspaces                                             |
| `pnpm build`        | Compiles TypeScript packages using project references (`tsc -b`)                        |
| `pnpm clean`        | Cleans all `dist/`, `coverage/`, and `.tsbuildinfo` artifacts                           |
| `pnpm format`       | Auto-formats all files using Prettier                                                   |
| `pnpm format:check` | Checks that all files conform to Prettier formatting                                    |
| `pnpm lint`         | Runs ESLint static analysis across all files                                            |
| `pnpm lint:fix`     | Runs ESLint and automatically applies fixes                                             |
| `pnpm type-check`   | Type-checks all packages, services, and tests (`tsc -p tsconfig.typecheck.json`)        |
| `pnpm test`         | Runs the Vitest test suite once                                                         |
| `pnpm test:watch`   | Runs Vitest in interactive watch mode                                                   |
| `pnpm verify`       | Executes the complete local quality gate suite (format, lint, build, type-check, tests) |

---

## 4. Canonical Service Architecture & Layer Conventions

All microservices within `services/` must follow the Clean / Hexagonal Architecture established in `templates/service`:

```
interfaces (Inbound Adapters: HTTP routes, controllers, middleware, health probes)
    ↓
application (Use Cases, Interactors, Inbound/Outbound Port Interfaces, DTOs)
    ↓
domain (Entities, Aggregates, Domain Errors, Invariants)
    ↓
infrastructure (Outbound Adapters: Persistence, Downstream Clients, Config)
```

### Directory Structure of a Service

```
services/<service-name>/
├── src/
│   ├── domain/               # Core business invariants, domain errors, entity models
│   │   ├── errors.ts         # Subclasses of AiDomainError
│   │   └── index.ts
│   ├── application/          # Use case interactors, command & query handlers, ports
│   │   ├── ports.ts          # AiUseCase and outbound port definitions
│   │   └── index.ts
│   ├── infrastructure/       # Outbound adapter implementations
│   │   ├── adapters.ts       # Database repositories, HTTP client proxies
│   │   └── index.ts
│   ├── interfaces/           # Inbound adapters (HTTP API, Event Listeners)
│   │   ├── http/
│   │   │   ├── health.ts     # Standard /healthz and /readyz probes
│   │   │   ├── middleware.ts # X-Correlation-ID, X-User-ID, error handler
│   │   │   └── router.ts     # HTTP request dispatcher
│   │   └── index.ts
│   ├── config.ts             # Service configuration schema with fail-fast validation
│   ├── service.ts            # Service instance lifecycle manager (start, stop, isReady)
│   └── index.ts              # Composition root & signal handlers
├── tests/
│   ├── unit/                 # Domain & application logic tests (isolated, in-memory)
│   └── integration/          # HTTP probe & adapter tests
├── package.json
└── tsconfig.json
```

### Scaffolding from the Reusable Template

The repository provides a canonical starter template in `templates/service` (`@oicunt-ai/service-template`). Future services can be scaffolded directly from this structure, ensuring strict adherence to Hexagonal Architecture, health endpoints, correlation context, and error mapping.

---

## 5. AI-Specific Engineering Conventions

1. **Use Canonical Model Identifiers**: Always use model identifiers from `@oicunt-ai/model-types` (e.g. `oicunt.model.catalog-alpha`). Raw upstream vendor names (`provider-model-beta`, `provider-model-alpha`) are strictly prohibited in application logic.
2. **Normalized Requests & Responses**: Inter-service AI calls must exchange `NormalizedCompletionRequest` and `NormalizedCompletionData` from `@oicunt-ai/ai-types`.
3. **No Provider SDK Leaks**: Provider SDKs (OpenAI, upstream provider, Google) are strictly confined to `providers/`. Never import `a vendor SDK`, `openai`, or `@google/genai` in services or shared packages.
4. **Zero-Trust Observability**: Record token counts, latency, and model metrics using `@oicunt-ai/observability`.
5. **Database-Per-Service Rule**: Never share a database between services. Services own their persistent storage exclusively.
6. **No Platform Duplication**: Do not build authentication, user management, billing, subscriptions, products, or usage tracking here. Those belong authoritatively in the company platform repository.

---

## 6. TypeScript Project References Rules

Packages and services utilize TypeScript Project References (`composite: true`) for fast, incremental, and type-safe builds:

1. When workspace `B` depends on workspace `A`:
   - In `B/package.json`: `"dependencies": { "@oicunt-ai/A": "workspace:*" }`
   - In `B/tsconfig.json`: `"references": [{ "path": "../A" }]`
2. In root `tsconfig.json`: Register all project references under `references`.
3. In root `tsconfig.typecheck.json`: Add module path aliases under `compilerOptions.paths`.

---

## 7. Pre-Commit & PR Quality Gates

Before submitting any Pull Request, run:

```bash
pnpm verify
```

This verifies that:

- Prettier formatting is satisfied (`pnpm format:check`)
- ESLint checks pass with zero errors and zero warnings (`pnpm lint`)
- All packages and templates build cleanly (`pnpm build`)
- Type checking passes monorepo-wide (`pnpm type-check`)
- All unit and integration tests pass (`pnpm test`)
