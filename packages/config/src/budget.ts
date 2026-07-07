/** Budget enforcement helpers (spec §30, §2.3). Pure + unit-tested. */

export interface BudgetState {
  xDailyUsed: number;
  xMonthlyUsed: number;
  claudeDailyRequests: number;
}

export interface BudgetLimits {
  xDailyResourceBudget: number;
  xMonthlyResourceBudget: number;
  claudeDailyRequestBudget: number;
  hardStop: boolean;
}

export type BudgetKind = "x_daily" | "x_monthly" | "claude_daily";

export interface BudgetDecision {
  allowed: boolean;
  kind?: BudgetKind;
  used?: number;
  limit?: number;
  /** When hardStop is false, over-budget still allows but flags a warning. */
  warning: boolean;
}

/**
 * Decide whether an X read of `requestedResources` may proceed. Respects daily and
 * monthly caps. With hardStop=false, over-budget is allowed but returns warning=true.
 */
export function checkXBudget(
  state: BudgetState,
  limits: BudgetLimits,
  requestedResources: number,
): BudgetDecision {
  const dailyAfter = state.xDailyUsed + requestedResources;
  const monthlyAfter = state.xMonthlyUsed + requestedResources;

  if (limits.xDailyResourceBudget > 0 && dailyAfter > limits.xDailyResourceBudget) {
    return decide(limits.hardStop, "x_daily", state.xDailyUsed, limits.xDailyResourceBudget);
  }
  if (limits.xMonthlyResourceBudget > 0 && monthlyAfter > limits.xMonthlyResourceBudget) {
    return decide(limits.hardStop, "x_monthly", state.xMonthlyUsed, limits.xMonthlyResourceBudget);
  }
  return { allowed: true, warning: false };
}

export function checkClaudeBudget(state: BudgetState, limits: BudgetLimits): BudgetDecision {
  if (
    limits.claudeDailyRequestBudget > 0 &&
    state.claudeDailyRequests + 1 > limits.claudeDailyRequestBudget
  ) {
    return decide(limits.hardStop, "claude_daily", state.claudeDailyRequests, limits.claudeDailyRequestBudget);
  }
  return { allowed: true, warning: false };
}

function decide(hardStop: boolean, kind: BudgetKind, used: number, limit: number): BudgetDecision {
  return { allowed: !hardStop, kind, used, limit, warning: true };
}

export function budgetUtilization(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(1, used / limit);
}
