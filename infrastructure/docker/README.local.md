# Local Infrastructure: PostgreSQL + RabbitMQ (`docker-compose.local.yml`)

Local Docker Compose setup for the datastores backing OICUNT AI services (Model Registry, Memory) and Platform Usage. Nothing here starts automatically; every command below is explicit.

## Prerequisites

- Docker Desktop running (Compose v2).
- Repository root `.env` prepared from `.env.example` (placeholders only in git; real `.env` is git-ignored). Never commit secrets.
- Host ports free: `5433`, `5672`, `15672` on `127.0.0.1`. Host port `5432` is intentionally untouched (an unrelated process already occupies it).

## Environment variables

Compose interpolates these from the root `.env` (run from the repository root):

| Name                                         | Purpose                                    |
| -------------------------------------------- | ------------------------------------------ |
| `POSTGRES_USER` / `POSTGRES_PASSWORD`        | Local Postgres superuser for the container |
| `POSTGRES_PORT`                              | Host port for Postgres (default `5433`)    |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD`        | Local broker credentials                   |
| `RABBITMQ_PORT` / `RABBITMQ_MANAGEMENT_PORT` | Host ports (defaults `5672` / `15672`)     |

Service processes need their own variables exported separately — **Node.js services do not read the root `.env`**: `DATABASE_HOST=127.0.0.1`, `DATABASE_PORT=5433`, `DATABASE_USER`/`DATABASE_PASSWORD`, per-service `DATABASE_NAME` (`oicunt_ai` registry, `oicunt_memory` memory, `oicunt_usage` platform usage), and `RABBITMQ_URL=amqp://<user>:<password>@127.0.0.1:5672`. `GROQ_API_KEY` belongs only in the Model Gateway process environment, never in these containers.

## Start and stop (from the repository root)

```powershell
docker compose -f infrastructure/docker/docker-compose.local.yml up -d
docker compose -f infrastructure/docker/docker-compose.local.yml ps
docker compose -f infrastructure/docker/docker-compose.local.yml logs -f postgres rabbitmq
docker compose -f infrastructure/docker/docker-compose.local.yml stop
docker compose -f infrastructure/docker/docker-compose.local.yml down
```

`down` keeps named volumes (data survives). `stop` only halts containers.

## Health verification

```powershell
docker inspect --format='{{.State.Health.Status}}' oicunt-postgres-local
docker inspect --format='{{.State.Health.Status}}' oicunt-rabbitmq-local
docker exec oicunt-postgres-local psql -U postgres -c '\l'
```

Both health checks report `healthy` when ready. RabbitMQ management UI: `http://127.0.0.1:15672` (loopback only).

## Connection addresses (services run on Windows, containers in Docker)

- PostgreSQL: `127.0.0.1:5433` → container `5432`. Container port vs host port differ deliberately (`5433` outside, `5432` inside).
- RabbitMQ AMQP: `127.0.0.1:5672`; management: `127.0.0.1:15672`.
- Queues/exchanges (`oicunt.usage`, `oicunt.usage.events`, DLX/DLQ) are declared by the application at startup — Compose provisions no broker topology.

## Topology and initialization

One Postgres server, three databases (`oicunt_ai`, `oicunt_memory`, `oicunt_usage`) created idempotently by `postgres/init-databases.sql` on first volume init. Each service migrator creates and owns its schema at service startup; no manual migration step.

## Volumes and reset

Data persists in named volumes `oicunt-postgres-data` and `oicunt-rabbitmq-data` across restarts. Destructive reset (deletes all local data — run only deliberately, containers stopped first):

```powershell
docker compose -f infrastructure/docker/docker-compose.local.yml down -v
```
