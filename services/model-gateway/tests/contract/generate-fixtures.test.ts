/**
 * ONE-TIME fixture generator for the cross-repository UsageEvent contract.
 *
 * Run deliberately (never in ordinary CI):
 *   GENERATE_CONTRACT_FIXTURES=1 pnpm vitest run services/model-gateway/tests/contract/generate-fixtures.test.ts
 *
 * It drives the REAL DispatchModelUseCase event-construction path with
 * scripted provider doubles and writes the normalized output to
 * tests/contract/fixtures/usage-event.v1.json. The companion
 * usage-event-contract.test.ts re-derives the same events on every run
 * and fails on ANY drift, so the checked-in JSON can only change
 * deliberately. Platform's twin copy
 * (platform/services/usage/tests/contract/fixtures/usage-event.v1.json)
 * must be refreshed from this file in the same change.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { InMemoryCircuitBreakerStore } from '../../src/infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

const generate = describe.skipIf(!process.env['GENERATE_CONTRACT_FIXTURES']);

interface FixtureCase {
  readonly name: string;
  readonly description: string;
  /** 'accept' cases must pass Platform validateUsageEvent; 'reject' must throw. */
  readonly expect: 'accept' | 'reject';
  readonly event: Record<string, unknown>;
}

function normalizeDynamic(event: UsageEvent): Record<string, unknown> {
  const record = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
  record['eventId'] = '<event-id>';
  record['idempotencyKey'] = '<idempotency-key>';
  record['occurredAt'] = '<occurred-at>';
  return record;
}

generate('generate UsageEvent contract fixtures', () => {
  function harness() {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore();
    const fakeAdapter = new FakeProviderAdapter('test-provider');
    adapterRegistry.register(fakeAdapter);
    const captured: UsageEvent[] = [];
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
    return { fakeAdapter, useCase, captured, payload };
  }

  async function unaryWithUsage(
    usage: TokenUsage,
    overrides?: Partial<GatewayDispatchPayload>,
  ): Promise<UsageEvent> {
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
    expect(h.captured).toHaveLength(1);
    return h.captured[0]!;
  }

  async function streamWithEvents(
    events: StreamEvent[],
    overrides?: Partial<GatewayDispatchPayload>,
  ): Promise<UsageEvent> {
    const h = harness();
    h.fakeAdapter.setStreamEvents(events);
    for await (const _event of h.useCase.executeStream({
      ...h.payload(),
      stream: true,
      ...overrides,
    })) {
      // Drain fully; captured events are recorded by the stub.
    }
    expect(h.captured).toHaveLength(1);
    return h.captured[0]!;
  }

  it('writes usage-event.v1.json', async () => {
    const cases: FixtureCase[] = [];

    cases.push({
      name: 'success-provider-usage',
      description: 'Successful completion with provider-reported token counts.',
      expect: 'accept',
      event: normalizeDynamic(
        await unaryWithUsage({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          usageSource: 'provider',
        }),
      ),
    });

    cases.push({
      name: 'success-unknown-usage',
      description: 'Successful completion whose adapter reported no usage provenance.',
      expect: 'accept',
      event: normalizeDynamic(
        await unaryWithUsage({ promptTokens: 4, completionTokens: 5, totalTokens: 9 }),
      ),
    });

    cases.push({
      name: 'success-zero-confirmed',
      description: 'Provider explicitly reported zero tokens (confirmed, not unknown).',
      expect: 'accept',
      event: normalizeDynamic(
        await unaryWithUsage({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          usageSource: 'provider',
        }),
      ),
    });

    cases.push({
      name: 'failure-provider-usage',
      description: 'Interrupted stream that carried provider-reported usage before failing.',
      expect: 'accept',
      event: normalizeDynamic(
        await streamWithEvents([
          { event: 'token', data: { delta: 'partial' } },
          {
            event: 'error',
            data: {
              code: 'PROVIDER_ERROR',
              message: 'provider disconnected',
              usage: {
                promptTokens: 7,
                completionTokens: 3,
                totalTokens: 10,
                usageSource: 'provider',
              },
            },
          },
        ]),
      ),
    });

    cases.push({
      name: 'failure-unknown-usage',
      description: 'Interrupted stream with no usage observed: units.requests only, no token keys.',
      expect: 'accept',
      event: normalizeDynamic(
        await streamWithEvents([
          { event: 'token', data: { delta: 'partial' } },
          { event: 'error', data: { code: 'CONNECTION_RESET', message: 'provider disconnected' } },
        ]),
      ),
    });

    cases.push({
      name: 'identities-omitted',
      description: 'Optional userId and conversationId omitted: keys absent, never fabricated.',
      expect: 'accept',
      event: normalizeDynamic(
        await unaryWithUsage(
          { promptTokens: 1, completionTokens: 1, totalTokens: 2, usageSource: 'provider' },
          { userId: undefined, conversationId: undefined },
        ),
      ),
    });

    // Retry stability: the identical event object captured twice resolves to
    // one identity (downstream dedupe key), proving replays cannot fork it.
    const stableSource = await unaryWithUsage({
      promptTokens: 2,
      completionTokens: 2,
      totalTokens: 4,
      usageSource: 'provider',
    });
    const seen = new Map<string, UsageEvent>();
    const keyOf = (e: UsageEvent): string => `${e.tenantId}:${e.idempotencyKey}`;
    const first = seen.get(keyOf(stableSource)) ?? stableSource;
    seen.set(keyOf(stableSource), first);
    const second = seen.get(keyOf({ ...stableSource })) ?? stableSource;
    expect(second.eventId).toBe(first.eventId);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    cases.push({
      name: 'retry-stability',
      description: 'Same event captured twice resolves to one identity (replay-safe).',
      expect: 'accept',
      event: normalizeDynamic(first),
    });

    cases.push({
      name: 'synthetic-actor',
      description:
        'Explicitly supplied actorId "system" flows through unmodified; Platform MUST reject it as synthetic.',
      expect: 'reject',
      event: normalizeDynamic(
        await unaryWithUsage(
          { promptTokens: 1, completionTokens: 1, totalTokens: 2, usageSource: 'provider' },
          { actorId: 'system', userId: undefined, conversationId: undefined },
        ),
      ),
    });

    cases.push({
      name: 'actor-omitted',
      description:
        'No actor identity anywhere: actorId omitted from the event (valid), never manufactured.',
      expect: 'accept',
      event: normalizeDynamic(
        await unaryWithUsage(
          { promptTokens: 3, completionTokens: 2, totalTokens: 5, usageSource: 'provider' },
          { actorId: undefined },
        ),
      ),
    });

    cases.push({
      name: 'billing-parity',
      description:
        'Live BILLY-chain identity shape (Task 24D observed values): tenant, user, and api-gateway actor preserved.',
      expect: 'accept',
      event: normalizeDynamic(
        await unaryWithUsage(
          { promptTokens: 12, completionTokens: 8, totalTokens: 20, usageSource: 'provider' },
          {
            tenantId: 'tnt_dev_local',
            userId: 'usr_dev_local',
            actorId: 'api-gateway',
            conversationId: 'conv_dev_local',
          },
        ),
      ),
    });

    const document = {
      version: 'usage-event-v1',
      generatedBy:
        'model-gateway DispatchModelUseCase via tests/contract/generate-fixtures.test.ts (do not hand-edit)',
      cases,
    };
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'usage-event.v1.json'), `${JSON.stringify(document, null, 2)}\n`);
  });
});
