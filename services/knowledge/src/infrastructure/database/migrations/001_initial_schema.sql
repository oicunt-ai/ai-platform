-- Dedicated schema for OICUNT Knowledge Service
CREATE SCHEMA IF NOT EXISTS oicunt_knowledge;

-- 1. Knowledge Collections table
CREATE TABLE IF NOT EXISTS oicunt_knowledge.knowledge_collections (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    embedding_model_id VARCHAR(128) NOT NULL,
    embedding_dimensions INTEGER NOT NULL,
    embedding_version VARCHAR(64) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_knowledge_collections_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_kcollections_tenant ON oicunt_knowledge.knowledge_collections (tenant_id);

-- 2. Knowledge Documents table
CREATE TABLE IF NOT EXISTS oicunt_knowledge.knowledge_documents (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    collection_id VARCHAR(64) NOT NULL REFERENCES oicunt_knowledge.knowledge_collections(id) ON DELETE CASCADE,
    title VARCHAR(512) NOT NULL,
    object_key VARCHAR(1024) NOT NULL,
    source_uri TEXT,
    mime_type VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    content_length_bytes BIGINT NOT NULL DEFAULT 0,
    document_hash VARCHAR(64) NOT NULL,
    total_chunks INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    error_phase VARCHAR(32),
    error_code VARCHAR(64),
    error_message TEXT,
    error_occurred_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_kdocs_tenant_collection ON oicunt_knowledge.knowledge_documents (tenant_id, collection_id);
CREATE INDEX IF NOT EXISTS idx_kdocs_tenant_status ON oicunt_knowledge.knowledge_documents (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_kdocs_tenant_hash ON oicunt_knowledge.knowledge_documents (tenant_id, collection_id, document_hash);

-- 3. Knowledge Document Chunks table
CREATE TABLE IF NOT EXISTS oicunt_knowledge.knowledge_chunks (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    collection_id VARCHAR(64) NOT NULL,
    document_id VARCHAR(64) NOT NULL REFERENCES oicunt_knowledge.knowledge_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    vector_id VARCHAR(128),
    embedding_model_id VARCHAR(128) NOT NULL,
    embedding_dimensions INTEGER NOT NULL,
    embedding_version VARCHAR(64) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_knowledge_chunks_doc_index UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kchunks_tenant_doc ON oicunt_knowledge.knowledge_chunks (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_kchunks_tenant_collection ON oicunt_knowledge.knowledge_chunks (tenant_id, collection_id);
