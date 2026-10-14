# OICUNT AI Platform — Agent Instructions

Short, self-contained entry point for coding agents (OpenCode, Codex,
Claude Code, Antigravity and compatible tools). This file guides; it does
not technically enforce permissions — always request operator approval for
the actions listed under Authorization boundaries.

## 1. Project purpose

AI-specific infrastructure for the OICUNT ecosystem: workflow
orchestration, canonical model catalog, vendor dispatch, tool/agent
runtimes, MCP integration, embeddings, Memory and GenAI observability.

## 2. Three-repository relationship

- **`ai-platform`** (this repo): everything AI-specific. Strictly
  independent from the company platform — never duplicate company-wide
  auth, gateway, billing or generic business logic here.
- **`platform`** (sibling): owns the public Gateway, identity, admission
  and the authoritative Usage ledger. This repo only _publishes_ usage
  events (Model Gateway outbox); the former `services/usage` duplicate was
  removed.
- **`billy`** (sibling): standalone product; consumes the public Gateway,
  never this repo directly.

Flow: Gateway → Orchestrator → (Registry, Memory, Inference →
Model Gateway → provider) → outbox → RabbitMQ → Platform Usage.

## 3. Local responsibility and boundaries

- Services (`127.0.0.1`): Registry `3001`, Model Gateway `3002`,
  Orchestrator `3003`, Inference `3004`, Memory `3005`.
- Workers: `agent-jobs`, `document-processing`, `embeddings`.
- Packages: `agent-types`, `ai-types`, `mcp-types`, `model-types`,
  `observability`, `tool-types` (+ `usage-types`, `internal-contracts`).
- Model registration uses the Registry admin API (no code seeds, no
  hardcoded aliases). `conversationId` is orchestrator-optional but
  gateway-required; when present, Memory hydration must succeed
  (tenant-owned, active conversation) or the turn fails.

## 4. Critical source locations

- Chat turn: `services/ai-orchestrator/src/application/use-cases/coordinate-chat-turn.use-case.ts`
- Memory HTTP surface: `services/memory/src/interfaces/http/`,
  use-cases in `services/memory/src/application/use-cases/`
- Model Gateway + provider adapters:
  `services/model-gateway/src/` (routing policy, retry, outbox capture)
- Registry: `services/model-registry/src/`
- Launchers (official, use these): `scripts/dev-up.mjs` (`pnpm dev`,
  starts the five services in dependency order with readiness gating),
  `scripts/dev-up-lib.mjs`
- Local datastores: `infrastructure/docker/docker-compose.local.yml`
  (compose interpolates root `.env`; `down -v` deletes all local data —
  never run without explicit approval)

## 5. Verified commands (from `package.json` / CI `.github/workflows/ci.yml`)

```bash
pnpm install --frozen-lockfile
pnpm build            # tsc -b (required before running launchers)
pnpm dev              # five services (needs PG/RMQ via compose first)
pnpm test             # vitest run
pnpm type-check       # tsc -p tsconfig.typecheck.json
pnpm lint             # eslint .
pnpm format:check     # prettier --check .
pnpm verify           # format + lint + type-check + build + tests
```

CI additionally checks out the Platform repo at a pinned SHA
(`PLATFORM_GATEWAY_PINNED_SHA` in
`tests/integration/platform-gateway-dist.ts`, must match the workflow
`ref` — update both together) or honors `PLATFORM_REPO_ROOT`.

## 6. Coding conventions (observed)

- Hexagonal services; pure, unit-testable use-cases and DTOs.
- TypeScript strict; Prettier + ESLint clean; vitest coverage per
  service/package.
- Explicit retry/routing configuration (priority-fallback,
  `max_fallback_attempts`); no implicit providers, no `guest@localhost`.
- Privacy-gated reasoning (`exposeReasoning` explicit opt-in; redact by
  default, including in logs).

## 7. Security expectations

- Provider keys (e.g. `GROQ_API_KEY`) live ONLY in the Model Gateway
  process environment — never in compose files, other services or git.
- Registry validation rejects secret-like keys in `adapterOptions`.
- Real `.env` is git-ignored; `.env.example` holds placeholders.
- Never log tokens, keys or passwords; never print JWTs.

## 8. Working methodology

- Inspect implementation before proposing changes; keep diffs narrow;
  preserve the public contract and service boundaries.
- Run relevant verification for touched files and report actual results.
- Distinguish verified observations from assumptions.
- Distinguish IMPLEMENTED (source + tests) from PROPOSED; product/company
  direction is intentionally absent here — see company vision in the
  Platform repo (`../platform/docs/company-vision.md`) and treat undecided
  items as OPEN.

## 9. Authorization boundaries (operator approval required)

Live AI provider requests; database migrations or direct data changes;
destructive operations; service/Docker restarts affecting the live dev
environment; credential, configuration or feature-flag changes (including
`ENABLE_USAGE_PUBLISHING`); commits, pushes, deployments. Read-only
inspection and safe local validation are fine.

## 10. Deeper documentation

- `README.md` — role, boundaries, layout
- `docs/architecture.md` — system context and dependency direction
- `docs/development.md` — setup, standards, workflow
- `docs/contracts/` — per-capability contracts (registry, routing,
  model-gateway, inference, memory, orchestrator, agents, tools, mcp,
  knowledge, embeddings, usage-publisher side)
- `providers/README.md` — model registration procedure
- `infrastructure/docker/README.local.md` — compose usage and ports
