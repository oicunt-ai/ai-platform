# OICUNT AI Platform

[![CI](https://github.com/oicunt-ai/ai-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/oicunt-ai/ai-platform/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-12.x-orange)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)

Production monorepo for the **OICUNT AI Platform**, owning all AI-specific infrastructure, models, agents, tools, and execution runtimes for the OICUNT enterprise ecosystem.

---

## 1. Architectural Role & Boundary

The OICUNT enterprise separates concerns between two primary repositories:

- **[`platform`](https://github.com/oicunt-ai/platform)**: Owns company-wide capabilities including user authentication (AuthN), public API Gateway, tenant management, billing, subscriptions, products, usage metering, relational databases, and enterprise events.
- **[`ai-platform`](https://github.com/oicunt-ai/ai-platform)** (This Repository): Owns **AI-specific infrastructure and capabilities**, including AI workflow orchestration, canonical model catalogs, vendor model dispatch, tool execution runtimes, autonomous agents, Model Context Protocol (MCP) integration, vector embedding pipelines, and GenAI observability.
- **BILLY**: BILLY is the OICUNT AI Assistant product—a separate product repository that consumes platform and ai-platform capabilities. BILLY is not a billing system.

```
┌─────────────────────────────────┐
│     OICUNT Company Platform     │  (Auth, API Gateway, Billing, Enterprise DBs)
└────────────────┬────────────────┘
                 │ Trusted Ingress Boundary
                 ▼
┌─────────────────────────────────┐
│       OICUNT AI Platform        │  (Orchestrator, Model Gateway, Agents, MCP)
└────────────────┬────────────────┘
                 │ Outbound Provider Boundary
                 ▼
┌─────────────────────────────────┐
│    Upstream Model Providers     │  (Anthropic, OpenAI, Google Gemini, Bedrock)
└─────────────────────────────────┘
```

> [!IMPORTANT]
> This repository is strictly independent from the company platform repository. Company-wide services, authentication handlers, and generic business logic must **never** be duplicated here.

---

## 2. Repository Layout

```
ai-platform/
├── .github/                 # GitHub Actions workflows & CI quality gates
├── docs/                    # Architecture and developer documentation
│   ├── architecture.md      # Platform architecture specifications & boundary contracts
│   └── development.md       # Development setup, standards, and workflow guide
├── infrastructure/          # Infrastructure as Code (IaC) & container definitions
│   ├── docker/              # Multi-stage Dockerfile definitions
│   ├── helm/                # Service & worker Helm charts
│   ├── kubernetes/          # Kubernetes workload manifests & overlays
│   └── terraform/           # Dedicated cloud AI infrastructure modules
├── packages/                # Foundational domain contracts & shared libraries
│   ├── agent-types/         # Agent configs, loops, state machines, and steps
│   ├── ai-types/            # Universal chat messages, completions, and streaming events
│   ├── mcp-types/           # Model Context Protocol (MCP) specifications
│   ├── model-types/         # Canonical model catalog, capabilities, and token usage
│   ├── observability/       # GenAI OpenTelemetry metrics and tracing contracts
│   └── tool-types/          # Tool schemas, execution parameters, and result types
├── providers/               # Upstream model provider adapter boundary (anti-corruption layer)
├── services/                # Autonomous AI microservices (Orchestrator, Model Gateway, etc.)
├── workers/                 # Asynchronous background workers & batch processors
│   ├── agent-jobs/          # Background multi-step autonomous agent runs
│   ├── document-processing/ # Document parsing, text extraction, and semantic chunking
│   └── embeddings/          # High-throughput vector embedding generation
├── scripts/                 # Operations, maintenance, and verification scripts
├── templates/               # Reusable AI service blueprints & templates
│   └── service/             # Canonical microservice starter template
└── tests/                   # Monorepo integration and foundation tests
```

---

## 3. Shared Packages

All shared packages are pure, strictly typed, and have zero external runtime dependencies:

| Package                                              | Workspace Name             | Purpose                                                                           |
| ---------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| [`packages/model-types`](./packages/model-types)     | `@oicunt-ai/model-types`   | Canonical model identifiers, capabilities, limits, pricing, and token metrics     |
| [`packages/ai-types`](./packages/ai-types)           | `@oicunt-ai/ai-types`      | Universal message parts, chat structures, normalized completions, and SSE streams |
| [`packages/tool-types`](./packages/tool-types)       | `@oicunt-ai/tool-types`    | Tool parameter JSON schemas, execution contexts, and tool execution contracts     |
| [`packages/agent-types`](./packages/agent-types)     | `@oicunt-ai/agent-types`   | Declarative agent configurations, execution states, and intermediate step traces  |
| [`packages/mcp-types`](./packages/mcp-types)         | `@oicunt-ai/mcp-types`     | Model Context Protocol specifications, framing, resources, prompts, and tools     |
| [`packages/observability`](./packages/observability) | `@oicunt-ai/observability` | OpenTelemetry GenAI semantic conventions, token metrics, and tracer test doubles  |

---

## 4. Getting Started

### Prerequisites

- **Node.js**: `22.x` (LTS) or `>=20.0.0`
- **pnpm**: `12.x` or `>=9.0.0`
- **Git**: `2.40+`

### Installation & Verification

```bash
# Install workspace dependencies
pnpm install

# Run the complete verification suite
pnpm verify
```

---

## 5. Development Commands

| Command             | Action                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| `pnpm build`        | Compile packages using TypeScript project references (`tsc -b`)              |
| `pnpm format:check` | Verify formatting across all files with Prettier                             |
| `pnpm format`       | Auto-format all files                                                        |
| `pnpm lint`         | Run ESLint static analysis                                                   |
| `pnpm lint:fix`     | Run ESLint and automatically fix issues                                      |
| `pnpm type-check`   | Run monorepo-wide type checking (`tsc -p tsconfig.typecheck.json`)           |
| `pnpm test`         | Execute the Vitest test suite                                                |
| `pnpm clean`        | Clean all build outputs (`dist/`, `coverage/`, `.tsbuildinfo`)               |
| `pnpm verify`       | Run all quality gates locally (format check, lint, build, type check, tests) |

---

## 6. Continuous Integration

The repository runs automated GitHub Actions CI (`.github/workflows/ci.yml`) on every push and pull request to `main`:

1. Dependency installation (`pnpm install --frozen-lockfile`)
2. Format validation (`pnpm format:check`)
3. Static linting (`pnpm lint`)
4. Type checking (`pnpm type-check`)
5. Test suite execution (`pnpm test`)
6. Package compilation (`pnpm build`)

---

## 7. Further Documentation

- **[Architecture Specification](docs/architecture.md)**: Comprehensive system context, boundary definitions, future service roadmap, and dependency direction.
- **[Development Guide](docs/development.md)**: Contributor onboarding, local setup, package creation, and testing guidelines.
