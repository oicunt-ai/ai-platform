import type { ModelPricing, TokenUsage } from '@oicunt-ai/model-types';

/**
 * Calculates estimated turn cost in USD based on Model Registry pricing tables.
 *
 * Cost is an operational transparency metric for telemetry spans and logs,
 * NOT a durable financial billing invoice.
 */
export class CostCalculator {
  public static calculateCostUsd(
    usage: TokenUsage,
    pricing?: ModelPricing | undefined,
  ): number | undefined {
    if (!pricing) {
      return undefined;
    }

    const cachedTokens = usage.cachedTokens ?? 0;
    const promptTokens = Math.max(0, usage.promptTokens - cachedTokens);
    const completionTokens = usage.completionTokens;
    const costPerCached = pricing.costPerMillionCachedTokens ?? pricing.costPerMillionInputTokens;

    const inputCost = (promptTokens / 1_000_000) * pricing.costPerMillionInputTokens;
    const cachedCost = (cachedTokens / 1_000_000) * costPerCached;
    const outputCost = (completionTokens / 1_000_000) * pricing.costPerMillionOutputTokens;

    return Number((inputCost + cachedCost + outputCost).toFixed(6));
  }
}

export function calculateTurnCost(
  pricing?: ModelPricing | undefined,
  usage?: TokenUsage | undefined,
): number | undefined {
  if (!usage) {
    return undefined;
  }
  return CostCalculator.calculateCostUsd(usage, pricing);
}
