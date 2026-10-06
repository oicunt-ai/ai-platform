CREATE SCHEMA IF NOT EXISTS oicunt_tools;

-- Canonical Tools Catalog
CREATE TABLE IF NOT EXISTS oicunt_tools.tools (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    source VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable Tool Versions
CREATE TABLE IF NOT EXISTS oicunt_tools.tool_versions (
    tool_id VARCHAR(128) NOT NULL REFERENCES oicunt_tools.tools(id) ON DELETE CASCADE,
    version VARCHAR(32) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    parameters_schema JSONB NOT NULL,
    output_schema JSONB,
    capabilities JSONB NOT NULL,
    timeout_policy JSONB NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deprecated BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (tool_id, version)
);

-- Tenant Entitlements & Role Configurations
CREATE TABLE IF NOT EXISTS oicunt_tools.tenant_tool_configs (
    tenant_id VARCHAR(64) NOT NULL,
    tool_id VARCHAR(128) NOT NULL REFERENCES oicunt_tools.tools(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    config_overrides JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, tool_id)
);

-- Durable Audit Trail
CREATE TABLE IF NOT EXISTS oicunt_tools.tool_audit_logs (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    tool_id VARCHAR(128) NOT NULL,
    version VARCHAR(32) NOT NULL,
    is_read_only BOOLEAN NOT NULL,
    sanitized_arguments JSONB NOT NULL,
    status VARCHAR(32) NOT NULL,
    duration_ms INT NOT NULL,
    confirmation_token_used TEXT,
    client_ip VARCHAR(64),
    correlation_id VARCHAR(128) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_audit_tenant_time ON oicunt_tools.tool_audit_logs (tenant_id, timestamp DESC);

-- Asynchronous Execution Jobs
CREATE TABLE IF NOT EXISTS oicunt_tools.tool_async_executions (
    execution_id VARCHAR(64) PRIMARY KEY,
    call_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    tool_id VARCHAR(128) NOT NULL,
    version VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    result JSONB,
    error JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tool_async_tenant_status ON oicunt_tools.tool_async_executions (tenant_id, status);
