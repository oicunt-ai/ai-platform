CREATE SCHEMA IF NOT EXISTS oicunt_mcp;

-- External MCP Server Registrations
CREATE TABLE IF NOT EXISTS oicunt_mcp.mcp_servers (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    transport_type VARCHAR(32) NOT NULL,
    transport_config JSONB NOT NULL,
    auth_secret_ref VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'inactive',
    protocol_version VARCHAR(32) NOT NULL DEFAULT '2024-11-05',
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_discovered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mcp_servers_tenant_name UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant ON oicunt_mcp.mcp_servers (tenant_id, status);

-- Normalized Capability Metadata: Tools
CREATE TABLE IF NOT EXISTS oicunt_mcp.mcp_server_tools (
    id VARCHAR(255) PRIMARY KEY,
    server_id VARCHAR(128) NOT NULL REFERENCES oicunt_mcp.mcp_servers(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    canonical_tool_id VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    input_schema JSONB NOT NULL,
    schema_hash VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_server_tools_server ON oicunt_mcp.mcp_server_tools (server_id, is_active);
CREATE INDEX IF NOT EXISTS idx_mcp_server_tools_tenant ON oicunt_mcp.mcp_server_tools (tenant_id);

-- Discovered Context Metadata: Resources
CREATE TABLE IF NOT EXISTS oicunt_mcp.mcp_server_resources (
    id VARCHAR(512) PRIMARY KEY,
    server_id VARCHAR(128) NOT NULL REFERENCES oicunt_mcp.mcp_servers(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    uri VARCHAR(512) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    mime_type VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_server_resources_server ON oicunt_mcp.mcp_server_resources (server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_server_resources_tenant ON oicunt_mcp.mcp_server_resources (tenant_id);

-- Discovered Scaffolding Metadata: Prompts
CREATE TABLE IF NOT EXISTS oicunt_mcp.mcp_server_prompts (
    id VARCHAR(512) PRIMARY KEY,
    server_id VARCHAR(128) NOT NULL REFERENCES oicunt_mcp.mcp_servers(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    arguments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_server_prompts_server ON oicunt_mcp.mcp_server_prompts (server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_server_prompts_tenant ON oicunt_mcp.mcp_server_prompts (tenant_id);
