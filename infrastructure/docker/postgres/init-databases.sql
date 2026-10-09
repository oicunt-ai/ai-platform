-- Local development bootstrap: create one database per service.
-- Each service migrator creates and owns its schema at startup
-- (model_registry, oicunt_memory, oicunt_usage), so only the databases
-- themselves are provisioned here. Idempotent: safe to re-run on restart
-- (files in /docker-entrypoint-initdb.d run only on first volume init).
SELECT 'CREATE DATABASE "oicunt_ai"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'oicunt_ai')\gexec
SELECT 'CREATE DATABASE "oicunt_memory"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'oicunt_memory')\gexec
SELECT 'CREATE DATABASE "oicunt_usage"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'oicunt_usage')\gexec
