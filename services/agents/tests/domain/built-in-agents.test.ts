import { describe, expect, it } from 'vitest';
import { BUILT_IN_AGENTS } from '../../src/domain/built-in-agents.js';

describe('Built-in Agents Registry', () => {
  it('defines valid canonical agents matching contract specifications', () => {
    expect(BUILT_IN_AGENTS.length).toBeGreaterThanOrEqual(3);

    const ids = BUILT_IN_AGENTS.map((b) => b.agent.agentId);
    expect(ids).toContain('oicunt.agent.general');
    expect(ids).toContain('oicunt.agent.researcher');
    expect(ids).toContain('oicunt.agent.data_analyst');

    for (const { agent, version } of BUILT_IN_AGENTS) {
      expect(agent.status).toBe('active');
      expect(version.version).toBe('1.0.0');
      expect(version.systemInstructions.length).toBeGreaterThan(10);
      expect(version.defaultBudget.maxSteps).toBeGreaterThanOrEqual(10);
      expect(version.isFrozen).toBe(true);
      expect(version.policy.confirmationBehavior).toBe('pause_and_notify');
      expect(version.policy.privacyPolicy.emitNormalizedThinkingEvents).toBe(true);
      expect(version.policy.privacyPolicy.redactThinkingInLogs).toBe(true);
    }
  });
});
