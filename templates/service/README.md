# AI Service Canonical Template

This template establishes the architectural foundation and code organization for all backend microservices within the **OICUNT AI Platform**.

---

## Architecture Overview

All AI platform services strictly enforce Clean / Hexagonal Architecture (Ports & Adapters):

```
templates/service/
├── src/
│   ├── domain/               # Enterprise domain logic, value objects & port interfaces
│   │   ├── errors.ts         # Domain error definitions
│   │   └── index.ts          # Aggregate roots & repository ports
│   ├── application/          # Use cases, interactors, and DTOs
│   │   ├── ports.ts          # Inbound & outbound application ports
│   │   └── index.ts          # Use cases returning domain results
│   ├── infrastructure/       # Outbound adapter implementations
│   │   ├── adapters.ts       # Concrete port implementations (e.g. in-memory or DB)
│   │   └── index.ts          # Re-exports & configuration loading
│   ├── interfaces/           # Inbound adapters (HTTP API, Event Listeners)
│   │   ├── http/             # HTTP router, middleware, and probe endpoints
│   │   │   ├── health.ts     # /healthz and /readyz endpoints
│   │   │   ├── middleware.ts # X-Correlation-ID & error mapping middleware
│   │   │   └── router.ts     # HTTP request dispatcher
│   │   └── index.ts
│   ├── config.ts             # Service configuration schema with fail-fast validation
│   ├── service.ts            # Service instance lifecycle manager (start, stop, health)
│   └── index.ts              # Composition root & signal handlers
├── tests/
│   ├── unit/                 # Domain & application logic tests (isolated, no I/O)
│   └── integration/          # HTTP probe & adapter tests
├── package.json
└── tsconfig.json
```

---

## Architectural Principles Enforced

1. **Inward Dependency Direction**: `interfaces` and `infrastructure` depend on `application` and `domain`. Inner layers never import from outer layers.
2. **Canonical Model Identifiers**: AI services consume `@oicunt-ai/model-types` and `@oicunt-ai/ai-types`. Raw vendor names are prohibited.
3. **Correlation & Identity Context**: Incoming `X-Correlation-ID`, `X-User-ID`, and `X-Tenant-ID` headers are propagated in request contexts.
4. **Health Probes**: Standard `/healthz` (liveness) and `/readyz` (readiness) for container orchestration.
5. **Fail-Fast Configuration**: Validates configuration at boot before starting listening sockets.
6. **Zero Provider Leaks**: Provider SDKs must never be imported here. Provider interaction occurs only through the Model Gateway egress boundary.
