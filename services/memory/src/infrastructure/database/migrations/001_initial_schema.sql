-- Schema initialization for OICUNT Memory Service
CREATE SCHEMA IF NOT EXISTS oicunt_memory;

SET search_path TO oicunt_memory, public;

-- Conversations Table
CREATE TABLE IF NOT EXISTS oicunt_memory.conversations (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    message_count INTEGER NOT NULL DEFAULT 0,
    total_tokens_estimate INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ NULL,
    retention_expires_at TIMESTAMPTZ NULL,
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_user ON oicunt_memory.conversations (tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_updated ON oicunt_memory.conversations (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_retention ON oicunt_memory.conversations (retention_expires_at)
    WHERE status != 'deleted' AND retention_expires_at IS NOT NULL;

-- Messages Table
CREATE TABLE IF NOT EXISTS oicunt_memory.conversation_messages (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL REFERENCES oicunt_memory.conversations(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    turn_id VARCHAR(64) NOT NULL,
    sequence_number INTEGER NOT NULL,
    role VARCHAR(32) NOT NULL,
    content JSONB NOT NULL,
    name VARCHAR(128) NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_messages_conversation_sequence UNIQUE (conversation_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq_desc ON oicunt_memory.conversation_messages (conversation_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_turn ON oicunt_memory.conversation_messages (tenant_id, turn_id);

-- Summaries Table
CREATE TABLE IF NOT EXISTS oicunt_memory.conversation_summaries (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL REFERENCES oicunt_memory.conversations(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    sequence_start INTEGER NOT NULL,
    sequence_end INTEGER NOT NULL,
    summary_text TEXT NOT NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summaries_conv_seq_end ON oicunt_memory.conversation_summaries (conversation_id, sequence_end DESC);

-- Future Extension: Memory Items Table (Episodic / Semantic Facts)
CREATE TABLE IF NOT EXISTS oicunt_memory.memory_items (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    conversation_id VARCHAR(64) NULL REFERENCES oicunt_memory.conversations(id) ON DELETE SET NULL,
    type VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_items_tenant_user ON oicunt_memory.memory_items (tenant_id, user_id, type, status);
