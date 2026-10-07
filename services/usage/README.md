# OICUNT Usage & Metering Service (`services/usage`)

## Overview

The **Usage & Metering Service** is the authoritative, centralized measurement, deduplication, persistence, aggregation, and query boundary for operational consumption across the entire OICUNT platform.

Its sole responsibility is to accurately record **what happened, when it happened, who caused it, and what resources were consumed**.

Usage metering is an out-of-band platform capability that strictly operates outside the runtime execution critical path.

## Architecture

Follows the canonical OICUNT Clean / Hexagonal Architecture:

```
services/usage/
├── src/
│   ├── domain/               # Core UsageEvent domain model, validation, UTC rollups, reversals
│   ├── application/          # Use cases and port interfaces (ingestion, query, reversals, recomputation)
│   ├── infrastructure/       # PostgreSQL (oicunt_usage schema), RabbitMQ, In-Memory storage, Logger
│   ├── interfaces/           # HTTP controllers, middleware, router, and AMQP consumer handlers
│   ├── config.ts             # Service configuration loader
│   ├── service.ts            # Composition root lifecycle orchestrator
│   └── index.ts              # Package entry point
└── tests/                    # Unit, integration, isolation, and end-to-end test suites
```

## Storage & Database Schema

- **Dedicated Database / Schema**: `oicunt_usage`
- **Tables**:
  - `usage_events`: Raw, immutable historical event records with `(tenant_id, idempotency_key)` uniqueness constraint.
  - `usage_aggregates_hourly`: Materialized hourly UTC rollups.
  - `usage_aggregates_daily`: Materialized daily UTC rollups.

## Ingestion Pipelines

1. **Asynchronous (Primary)**:
   - RabbitMQ exchange: `oicunt.usage` (topic)
   - Queue: `oicunt.usage.events`
   - Dead-Letter Exchange: `oicunt.usage.dlx`
   - Dead-Letter Queue: `oicunt.usage.dlq`
   - Routing Key Pattern: `usage.v1.<sourceService>.<operation>`
2. **Synchronous (Secondary)**:
   - `POST /internal/v1/usage/events`
   - `POST /internal/v1/usage/events/batch`

## Query Endpoints

- `GET /internal/v1/usage/summary`
- `GET /internal/v1/usage/timeseries`
- `GET /internal/v1/usage/events`
- `POST /internal/v1/usage/reversals`
- `POST /internal/v1/usage/aggregates/recompute`
- `GET /health/liveness`
- `GET /health/readiness`
