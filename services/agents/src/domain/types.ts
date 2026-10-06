/**
 * Canonical Agent identifier format: `oicunt.agent.${string}`
 */
export type AgentId = `oicunt.agent.${string}`;

/**
 * Unique identifier for a specific execution run.
 */
export type AgentRunId = `run_${string}`;

/**
 * Unique identifier for a discrete execution step.
 */
export type AgentStepId = `step_${string}`;

/**
 * Broad functional categories for AI agents.
 */
export type AgentCategory =
  'researcher' | 'analyst' | 'coordinator' | 'coding' | 'workflow' | 'custom';

/**
 * Operational status of an agent catalog entry.
 */
export type AgentStatus = 'draft' | 'active' | 'deprecated' | 'archived';

/**
 * Lifecycle status of an individual agent execution run.
 */
export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_confirmation'
  | 'waiting_for_input'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/**
 * Category of work in a multi-step execution cycle.
 */
export type AgentStepType = 'planning' | 'thought' | 'action' | 'observation' | 'response';

/**
 * Execution status of a discrete step.
 */
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Terminal reasons for run loop conclusion.
 */
export type TerminationReason =
  | 'goal_achieved'
  | 'max_steps_exceeded'
  | 'deadline_exceeded'
  | 'token_budget_exceeded'
  | 'tool_call_limit_exceeded'
  | 'consecutive_errors_exceeded'
  | 'cancelled_by_user'
  | 'confirmation_expired'
  | 'confirmation_rejected'
  | 'input_timeout'
  | 'fatal_tool_error'
  | 'fatal_inference_error'
  | 'policy_violation';

/**
 * Resume payload discrimination type.
 */
export type ResumeType = 'confirmation' | 'user_input';

/**
 * Execution invocation mode.
 */
export type ExecutionMode = 'sync' | 'async';
