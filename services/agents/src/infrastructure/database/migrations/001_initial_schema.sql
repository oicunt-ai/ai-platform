CREATE SCHEMA IF NOT EXISTS oicunt_agents;

-- 1. Agent Catalog Definitions
CREATE TABLE IF NOT EXISTS oicunt_agents.agents (
    agent_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Immutable Published Agent Versions
CREATE TABLE IF NOT EXISTS oicunt_agents.agent_versions (
    agent_id VARCHAR(64) NOT NULL REFERENCES oicunt_agents.agents(agent_id),
    version VARCHAR(32) NOT NULL,
    system_instructions TEXT NOT NULL,
    default_model VARCHAR(64) NOT NULL,
    default_effort VARCHAR(16) NOT NULL DEFAULT 'medium',
    allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    default_budget JSONB NOT NULL,
    policy JSONB NOT NULL,
    is_frozen BOOLEAN NOT NULL DEFAULT TRUE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, version)
);

-- 3. Execution Runs
CREATE TABLE IF NOT EXISTS oicunt_agents.agent_runs (
    run_id VARCHAR(64) PRIMARY KEY,
    agent_id VARCHAR(64) NOT NULL,
    agent_version VARCHAR(32) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    conversation_id VARCHAR(64),
    status VARCHAR(32) NOT NULL,
    budget JSONB NOT NULL,
    cumulative_usage JSONB NOT NULL DEFAULT '{"promptTokens":0,"completionTokens":0,"totalTokens":0}'::jsonb,
    final_output TEXT,
    termination_reason VARCHAR(64),
    current_step_number INT NOT NULL DEFAULT 0,
    worker_lease_id VARCHAR(64),
    lease_expires_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (agent_id, agent_version) REFERENCES oicunt_agents.agent_versions(agent_id, version)
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status ON oicunt_agents.agent_runs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_correlation ON oicunt_agents.agent_runs(correlation_id);

-- 4. Ordered Step History & Observations (Zero Raw Chain-of-Thought)
CREATE TABLE IF NOT EXISTS oicunt_agents.agent_steps (
    step_id VARCHAR(64) PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL REFERENCES oicunt_agents.agent_runs(run_id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    step_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    decision_summary TEXT,
    structured_decision JSONB,
    action JSONB,
    observation JSONB,
    step_usage JSONB,
    duration_ms INT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (run_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON oicunt_agents.agent_steps(run_id, step_number ASC);

-- 5. Execution Checkpoints (for Pause/Resume & Worker Recovery)
CREATE TABLE IF NOT EXISTS oicunt_agents.agent_checkpoints (
    checkpoint_id VARCHAR(64) PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL REFERENCES oicunt_agents.agent_runs(run_id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    state_payload JSONB NOT NULL,
    pending_challenge JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, step_number)
);
