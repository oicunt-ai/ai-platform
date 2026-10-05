-- OICUNT AI Platform: Model Registry Schema
-- Version: 001_initial_schema

CREATE SCHEMA IF NOT EXISTS model_registry;

-- 1. Canonical Models master catalog
CREATE TABLE IF NOT EXISTS model_registry.canonical_models (
    id VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    active_version VARCHAR(32) NOT NULL,
    version_lock INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Model Versions (immutable snapshots)
CREATE TABLE IF NOT EXISTS model_registry.model_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_model_id VARCHAR(64) NOT NULL REFERENCES model_registry.canonical_models(id) ON DELETE CASCADE,
    version VARCHAR(32) NOT NULL,
    modalities VARCHAR(32)[] NOT NULL,
    capabilities JSONB NOT NULL,
    limits JSONB NOT NULL,
    pricing JSONB NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'available',
    is_immutable BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_canonical_model_version UNIQUE (canonical_model_id, version)
);

CREATE INDEX IF NOT EXISTS idx_model_versions_canonical_id ON model_registry.model_versions(canonical_model_id);

-- 3. Model Targets (execution endpoints)
CREATE TABLE IF NOT EXISTS model_registry.model_targets (
    id VARCHAR(64) PRIMARY KEY,
    model_version_id UUID NOT NULL REFERENCES model_registry.model_versions(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    upstream_model_id VARCHAR(128) NOT NULL,
    priority INT NOT NULL DEFAULT 1,
    weight INT NOT NULL DEFAULT 100,
    region VARCHAR(32),
    adapter_options JSONB,
    supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(24) NOT NULL DEFAULT 'available',
    max_concurrency INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_targets_version_id ON model_registry.model_targets(model_version_id);

-- 4. Routing Policies
CREATE TABLE IF NOT EXISTS model_registry.routing_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_model_id VARCHAR(64) NOT NULL UNIQUE REFERENCES model_registry.canonical_models(id) ON DELETE CASCADE,
    strategy VARCHAR(32) NOT NULL DEFAULT 'priority-fallback',
    max_fallback_attempts INT NOT NULL DEFAULT 2,
    require_healthy_target BOOLEAN NOT NULL DEFAULT TRUE,
    degradation_behavior VARCHAR(32) NOT NULL DEFAULT 'fail-fast',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Model Aliases
CREATE TABLE IF NOT EXISTS model_registry.model_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_model_id VARCHAR(64) NOT NULL REFERENCES model_registry.canonical_models(id) ON DELETE CASCADE,
    alias_name VARCHAR(32) NOT NULL,
    target_version VARCHAR(32) NOT NULL,
    tenant_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_model_alias_global
ON model_registry.model_aliases(canonical_model_id, alias_name)
WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_model_alias_tenant
ON model_registry.model_aliases(canonical_model_id, alias_name, tenant_id)
WHERE tenant_id IS NOT NULL;

-- 6. Audit Events (Append-Only)
CREATE TABLE IF NOT EXISTS model_registry.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    reason TEXT,
    before_state JSONB,
    after_state JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON model_registry.audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_correlation ON model_registry.audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON model_registry.audit_events(created_at DESC);
