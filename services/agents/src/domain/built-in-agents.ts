import type { Agent, AgentVersion } from './entities.js';

export const BUILT_IN_AGENTS: readonly { agent: Agent; version: AgentVersion }[] = [
  {
    agent: {
      agentId: 'oicunt.agent.general',
      name: 'General Assistant Agent',
      description:
        'Autonomous multi-step coordinator for general tasks, problem solving, and tool actions.',
      category: 'coordinator',
      status: 'active',
      latestVersion: '1.0.0',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    },
    version: {
      agentId: 'oicunt.agent.general',
      version: '1.0.0',
      systemInstructions:
        'You are the OICUNT General Assistant Agent. Analyze the user goal, form a clear step-by-step plan, use available tools where appropriate, and provide a comprehensive final answer.',
      defaultModel: 'claude-sonnet',
      defaultEffort: 'medium',
      allowedTools: ['*'],
      defaultBudget: {
        maxSteps: 15,
        deadlineMs: 0, // dynamically resolved
        maxModelCalls: 20,
        maxToolCalls: 30,
        maxConsecutiveErrors: 3,
      },
      policy: {
        toolCallMode: 'auto',
        confirmationBehavior: 'pause_and_notify',
        privacyPolicy: {
          emitNormalizedThinkingEvents: true,
          redactThinkingInLogs: true,
        },
        maxConsecutiveErrors: 3,
      },
      isFrozen: true,
      publishedAt: '2026-10-06T00:00:00.000Z',
    },
  },
  {
    agent: {
      agentId: 'oicunt.agent.researcher',
      name: 'Research & Knowledge Agent',
      description:
        'Specialized autonomous researcher that gathers information from enterprise knowledge spaces and search tools.',
      category: 'researcher',
      status: 'active',
      latestVersion: '1.0.0',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    },
    version: {
      agentId: 'oicunt.agent.researcher',
      version: '1.0.0',
      systemInstructions:
        'You are the OICUNT Research & Knowledge Agent. Your objective is thorough investigation, verifying facts from knowledge collections and search tools, and synthesizing grounded, citation-rich summaries.',
      defaultModel: 'claude-sonnet',
      defaultEffort: 'medium',
      allowedTools: [
        'oicunt.tool.knowledge_search',
        'oicunt.tool.web_search',
        'oicunt.tool.document_extract',
      ],
      defaultBudget: {
        maxSteps: 20,
        deadlineMs: 0,
        maxModelCalls: 25,
        maxToolCalls: 40,
        maxConsecutiveErrors: 3,
      },
      policy: {
        toolCallMode: 'auto',
        confirmationBehavior: 'pause_and_notify',
        privacyPolicy: {
          emitNormalizedThinkingEvents: true,
          redactThinkingInLogs: true,
        },
        maxConsecutiveErrors: 3,
      },
      isFrozen: true,
      publishedAt: '2026-10-06T00:00:00.000Z',
    },
  },
  {
    agent: {
      agentId: 'oicunt.agent.data_analyst',
      name: 'Quantitative Data Analyst Agent',
      description:
        'Specialized agent for mathematical computations, tabular data processing, and metrics generation.',
      category: 'analyst',
      status: 'active',
      latestVersion: '1.0.0',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    },
    version: {
      agentId: 'oicunt.agent.data_analyst',
      version: '1.0.0',
      systemInstructions:
        'You are the OICUNT Quantitative Data Analyst Agent. Solve analytical challenges by querying structured datasets, running deterministic calculations, and delivering concise metric summaries.',
      defaultModel: 'claude-sonnet',
      defaultEffort: 'medium',
      allowedTools: [
        'oicunt.tool.calculator',
        'oicunt.tool.code_interpreter',
        'oicunt.tool.sql_query',
      ],
      defaultBudget: {
        maxSteps: 15,
        deadlineMs: 0,
        maxModelCalls: 20,
        maxToolCalls: 25,
        maxConsecutiveErrors: 3,
      },
      policy: {
        toolCallMode: 'auto',
        confirmationBehavior: 'pause_and_notify',
        privacyPolicy: {
          emitNormalizedThinkingEvents: true,
          redactThinkingInLogs: true,
        },
        maxConsecutiveErrors: 3,
      },
      isFrozen: true,
      publishedAt: '2026-10-06T00:00:00.000Z',
    },
  },
];
