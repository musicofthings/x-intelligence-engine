import type { Env } from "./env.js";

/**
 * Cost estimation (spec §33, §6.10). Vendor pricing is configurable and NOT buried
 * in business logic — everything here reads from env-provided rates and every value
 * is labelled an estimate by callers.
 */
export interface PricingConfig {
  xPostReadUnitCostUsd: number;
  xUserReadUnitCostUsd: number;
  claudeInputCostPerMillion: number;
  claudeOutputCostPerMillion: number;
}

export function pricingFromEnv(env: Env): PricingConfig {
  return {
    xPostReadUnitCostUsd: env.X_POST_READ_UNIT_COST_USD,
    xUserReadUnitCostUsd: env.X_USER_READ_UNIT_COST_USD,
    claudeInputCostPerMillion: env.CLAUDE_INPUT_COST_PER_MILLION,
    claudeOutputCostPerMillion: env.CLAUDE_OUTPUT_COST_PER_MILLION,
  };
}

export function estimateXCost(p: PricingConfig, postsRead: number, usersRead = 0): number {
  return round4(postsRead * p.xPostReadUnitCostUsd + usersRead * p.xUserReadUnitCostUsd);
}

export function estimateClaudeCost(p: PricingConfig, inputTokens: number, outputTokens: number): number {
  return round4(
    (inputTokens / 1_000_000) * p.claudeInputCostPerMillion +
      (outputTokens / 1_000_000) * p.claudeOutputCostPerMillion,
  );
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
