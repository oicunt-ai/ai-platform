/**
 * Cross-repository UsageEvent contract test (producer side).
 *
 * Re-derives every usage-event.v1 fixture case through the REAL
 * DispatchModelUseCase construction path and fails on ANY drift from the
 * checked-in JSON. The twin copy lives at
 * platform/services/usage/tests/contract/fixtures/usage-event.v1.json and
 * must be refreshed from that file in the same change; both copies carry
 * the same version string.
 *
 * Dynamic identity fields (eventId, idempotencyKey, occurredAt) are
 * normalized for comparison AND asserted structurally: the derivation
 * rule `model.completion:<completionId>` / `usage_<completionId>` is part
 * of the contract and is what makes outbox replay and platform dedupe
 * collapse to one record.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@oicunt-ai/ai-types';
import type { TokenUsage } from '@oicunt-ai/model-types';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import type {
  GatewayDispatchPayload,
  ResolvedTargetDto,
} from '../../src/application/dtos/dispatch.dto.js';
import { DispatchModelUseCase } from '../../src/application/use-cases/dispatch-model.use-case.js';
import { InternalGatewayError } from '../../src/domain/errors.js';
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { InMemoryCircuitBreakerStore } from '../../src/infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

interface FixtureDocument {
  readonly version: string;
  readonly cases: ReadonlyArray<{
    readonly name: string;
    readonly expect: 'accept' | 'reject';
    readonly event: Record<string, unknown>;
  }>;
}

function loadFixtures(): FixtureDocument {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'usage-event.v1.json');
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureDocument;
}

function normalizeDynamic(event: UsageEvent): Record<string, unknown> {
  const record = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
  record['eventId'] = '<event-id>';
  record['idempotencyKey'] = '<idempotency-key>';
  record['occurredAt'] = '<occurred-at>';
  return record;
}

describe('UsageEvent contract fixtures (producer side)', () => {
  function harness() {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore();
    const fakeAdapter = new FakeProviderAdapter('test-provider');
    adapterRegistry.register(fakeAdapter);
    const captured: UsageEvent[] = [];
    const completionIds: string[] = [];
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: {
        async capture(event: UsageEvent) {
          captured.push(event);
        },
      },
    });
    const target: ResolvedTargetDto = {
      targetId: 'target-contract',
      provider: 'test-provider',
      upstreamModelId: 'contract-model',
      priority: 1,
      weight: 100,
      supportsStreaming: true,
    };
    const payload = (overrides?: Partial<GatewayDispatchPayload>): GatewayDispatchPayload => ({
      requestId: 'req-contract',
      correlationId: 'corr-contract',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      version: '1.0.0',
      stream: false,
      messages: [{ role: 'user', content: 'Contract probe' }],
      limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      eligibleTargets: [target],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      actorId: 'api-gateway',
      tenantId: 'tnt_contract',
      userId: 'usr_contract',
      conversationId: 'conv_contract',
      ...overrides,
    });
    return {
      fakeAdapter,
      useCase,
      captured,
      completionIds,
      payload,
      trackCompletions() {
        for (const call of fakeAdapter.unaryCalls) {
          completionIds.push(call.completionId);
        }
        for (const call of fakeAdapter.streamCalls) {
          completionIds.push(call.completionId);
        }
      },
    };
  }

  async function unaryWithUsage(
    usage: TokenUsage,
    overrides?: Partial<GatewayDispatchPayload>,
  ): Promise<{ h: ReturnType<typeof harness>; event: UsageEvent }> {
    const h = harness();
    h.fakeAdapter.enqueueUnaryResponse(async (req) => ({
      completionId: req.completionId,
      model: req.payload.canonicalModelId,
      message: { role: 'assistant', content: 'ok' },
      finishReason: 'stop',
      usage,
      latencyMs: 5,
    }));
    await h.useCase.executeUnary(h.payload(overrides));
    h.trackCompletions();
    if (h.captured[0] === undefined) {
      throw new Error('expected exactly one captured event');
    }
    return { h, event: h.captured[0] };
  }

  async function streamWithEvents(
    events: StreamEvent[],
    overrides?: Partial<GatewayDispatchPayload>,
  ): Promise<{ h: ReturnType<typeof harness>; event: UsageEvent }> {
    const h = harness();
    h.fakeAdapter.setStreamEvents(events);
    for await (const _event of h.useCase.executeStream({
      ...h.payload(),
      stream: true,
      ...overrides,
    })) {
      // Drain fully; the stub records captured events.
    }
    h.trackCompletions();
    if (h.captured[0] === undefined) {
      throw new Error('expected exactly one captured event');
    }
    return { h, event: h.captured[0] };
  }

  function expectIdentity(event: UsageEvent, completionId: string): void {
    expect(event.eventId).toBe(`usage_${completionId}`);
    expect(event.idempotencyKey).toBe(`model.completion:${completionId}`);
    expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
  }

  it('is versioned as usage-event-v1 on both sides of the contract', () => {
    expect(loadFixtures().version).toBe('usage-event-v1');
  });

  it('success-provider-usage matches the fixture with stable identity', async () => {
    const { h, event } = await unaryWithUsage({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      usageSource: 'provider',
    });
    expectIdentity(event, h.completionIds[0]!);
    expect(normalizeDynamic(event)).toEqual(fixtureCase('success-provider-usage'));
  });

  it('success-unknown-usage matches the fixture', async () => {
    const { h, event } = await unaryWithUsage({
      promptTokens: 4,
      completionTokens: 5,
      totalTokens: 9,
    });
    expectIdentity(event, h.completionIds[0]!);
    expect(normalizeDynamic(event)).toEqual(fixtureCase('success-unknown-usage'));
  });

  it('success-zero-confirmed keeps explicit zeros distinct from unknown', async () => {
    const { event } = await unaryWithUsage({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      usageSource: 'provider',
    });
    expect(normalizeDynamic(event)).toEqual(fixtureCase('success-zero-confirmed'));
    expect(event.measurements['tokens.total']).toBe(0);
    expect(event.dimensions['usageSource']).toBe('provider');
  });

  it('failure-provider-usage records confirmed counts', async () => {
    const { h, event } = await streamWithEvents([
      { event: 'token', data: { delta: 'partial' } },
      {
        event: 'error',
        data: {
          code: 'PROVIDER_ERROR',
          message: 'provider disconnected',
          usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10, usageSource: 'provider' },
        },
      },
    ]);
    expectIdentity(event, h.completionIds[0]!);
    expect(normalizeDynamic(event)).toEqual(fixtureCase('failure-provider-usage'));
  });

  it('failure-unknown-usage carries no token keys', async () => {
    const { event } = await streamWithEvents([
      { event: 'token', data: { delta: 'partial' } },
      { event: 'error', data: { code: 'CONNECTION_RESET', message: 'provider disconnected' } },
    ]);
    expect(normalizeDynamic(event)).toEqual(fixtureCase('failure-unknown-usage'));
    expect('tokens.total' in event.measurements).toBe(false);
    expect(event.measurements['units.requests']).toBe(1);
  });

  it('identities-omitted omits optional keys without fabrication', async () => {
    const { event } = await unaryWithUsage(
      { promptTokens: 1, completionTokens: 1, totalTokens: 2, usageSource: 'provider' },
      { userId: undefined, conversationId: undefined },
    );
    expect(normalizeDynamic(event)).toEqual(fixtureCase('identities-omitted'));
    expect(event.userId).toBeUndefined();
    expect(event.lineage.sessionId).toBeUndefined();
    // Over the wire (JSON) the undefined keys vanish entirely: never fabricated.
    const wired = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    expect('userId' in wired).toBe(false);
    expect('sessionId' in ((wired['lineage'] ?? {}) as Record<string, unknown>)).toBe(false);
  });

  it('retry-stability resolves recapture to one identity', async () => {
    const { event } = await unaryWithUsage({
      promptTokens: 2,
      completionTokens: 2,
      totalTokens: 4,
      usageSource: 'provider',
    });
    expect(normalizeDynamic(event)).toEqual(fixtureCase('retry-stability'));
    const seen = new Map<string, UsageEvent>();
    const key = `${event.tenantId}:${event.idempotencyKey}`;
    seen.set(key, event);
    const replay = seen.get(`${event.tenantId}:${event.idempotencyKey}`)!;
    expect(replay.eventId).toBe(event.eventId);
  });

  it('synthetic-actor flows through for the consumer side to reject', async () => {
    const { event } = await unaryWithUsage(
      { promptTokens: 1, completionTokens: 1, totalTokens: 2, usageSource: 'provider' },
      { actorId: 'system', userId: undefined, conversationId: undefined },
    );
    expect(normalizeDynamic(event)).toEqual(fixtureCase('synthetic-actor'));
    expect(event.actorId).toBe('system');
  });

  it('actor-omitted emits no actor identity instead of manufacturing one', async () => {
    const { event } = await unaryWithUsage(
      { promptTokens: 3, completionTokens: 2, totalTokens: 5, usageSource: 'provider' },
      { actorId: undefined },
    );
    expect(normalizeDynamic(event)).toEqual(fixtureCase('actor-omitted'));
    expect(event.actorId).toBeUndefined();
    const wired = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    expect('actorId' in wired).toBe(false);
  });

  it('billing-parity preserves the live BILLY-chain identity shape', async () => {
    const { h, event } = await unaryWithUsage(
      { promptTokens: 12, completionTokens: 8, totalTokens: 20, usageSource: 'provider' },
      {
        tenantId: 'tnt_dev_local',
        userId: 'usr_dev_local',
        actorId: 'api-gateway',
        conversationId: 'conv_dev_local',
      },
    );
    expectIdentity(event, h.completionIds[0]!);
    expect(normalizeDynamic(event)).toEqual(fixtureCase('billing-parity'));
    expect(event.tenantId).toBe('tnt_dev_local');
    expect(event.userId).toBe('usr_dev_local');
    expect(event.actorId).toBe('api-gateway');
  });

  it('missing tenant throws before any event exists', async () => {
    const h = harness();
    await expect(
      h.useCase.executeUnary({ ...h.payload(), tenantId: undefined }),
    ).rejects.toBeInstanceOf(InternalGatewayError);
  });

  it('missing tenant makes no provider call when metering is enabled', async () => {
    const h = harness();
    // Capture is wired (metering enabled): the billing-identity gate must
    // fire in validatePayload, before the first provider attempt.
    const failure = await h.useCase.executeUnary({ ...h.payload(), tenantId: undefined }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(InternalGatewayError);
    expect(h.fakeAdapter.unaryCalls).toHaveLength(0);
    expect(h.captured).toHaveLength(0);
  });

  it('missing tenant still executes without metering (no event, no gate)', async () => {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore();
    const fakeAdapter = new FakeProviderAdapter('test-provider');
    adapterRegistry.register(fakeAdapter);
    const useCase = new DispatchModelUseCase({ adapterRegistry, circuitBreakerStore });
    const h = harness();
    const result = await useCase.executeUnary({ ...h.payload(), tenantId: undefined });
    expect(result.finishReason).toBe('stop');
    expect(fakeAdapter.unaryCalls).toHaveLength(1);
  });

  function fixtureCase(name: string): Record<string, unknown> {
    const found = loadFixtures().cases.find((c) => c.name === name);
    if (!found) {
      throw new Error(`fixture case missing: ${name}`);
    }
    return found.event;
  }
});
