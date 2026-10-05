import type { ModelPricing, TokenUsage } from '@oicunt-ai/model-types';

export function calculateInferenceCost(
  pricing: ModelPricing | undefined,
  usage: TokenUsage | undefined,
): number | undefined {
  if (!pricing || !usage) {
    return undefined;
  }

  const promptCost = (usage.promptTokens / 1_000_000) * pricing.costPerMillionInputTokens;
  const completionCost = (usage.completionTokens / 1_000_000) * pricing.costPerMillionOutputTokens;
  const cachedCost =
    usage.cachedTokens && pricing.costPerMillionCachedTokens
      ? (usage.cachedTokens / 1_000_000) * pricing.costPerMillionCachedTokens
      : 0;

  const totalCost = promptCost + completionCost + cachedCost;
  return Number(totalCost.toFixed(6));
}
