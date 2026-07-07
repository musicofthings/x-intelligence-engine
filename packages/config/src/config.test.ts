import { describe, it, expect } from "vitest";
import { loadEnv, capabilities } from "./env.js";
import { checkXBudget, checkClaudeBudget, budgetUtilization } from "./budget.js";
import { bandForScore } from "./scoring.js";
import { estimateClaudeCost, estimateXCost, pricingFromEnv } from "./pricing.js";
import { isMonitorDue, localTimeToUtcMinutes, ASIA_KOLKATA_OFFSET_MINUTES } from "./schedule.js";

describe("env", () => {
  it("boots with defaults and reports capability gaps", () => {
    const env = loadEnv({});
    const caps = capabilities(env);
    expect(caps.xApiConfigured).toBe(false);
    expect(caps.claudeConfigured).toBe(false);
    expect(env.APP_TIMEZONE).toBe("Asia/Kolkata");
  });

  it("detects configured capabilities", () => {
    const env = loadEnv({ X_BEARER_TOKEN: "t", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-x" });
    const caps = capabilities(env);
    expect(caps.xApiConfigured).toBe(true);
    expect(caps.claudeConfigured).toBe(true);
  });

  it("refuses dev auth in production", () => {
    expect(() => loadEnv({ APP_ENV: "production", AUTH_MODE: "development" })).toThrow(/production/);
  });

  it("refuses demo mode in production", () => {
    expect(() =>
      loadEnv({ APP_ENV: "production", AUTH_MODE: "cloudflare_access", DEMO_MODE: "true" }),
    ).toThrow(/DEMO_MODE/);
  });
});

describe("budget", () => {
  const limits = {
    xDailyResourceBudget: 100,
    xMonthlyResourceBudget: 1000,
    claudeDailyRequestBudget: 10,
    hardStop: true,
  };

  it("allows within daily budget", () => {
    const d = checkXBudget({ xDailyUsed: 50, xMonthlyUsed: 200, claudeDailyRequests: 0 }, limits, 40);
    expect(d.allowed).toBe(true);
  });

  it("hard-stops over daily budget", () => {
    const d = checkXBudget({ xDailyUsed: 90, xMonthlyUsed: 200, claudeDailyRequests: 0 }, limits, 20);
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe("x_daily");
    expect(d.warning).toBe(true);
  });

  it("warns-but-allows when hardStop off", () => {
    const soft = { ...limits, hardStop: false };
    const d = checkXBudget({ xDailyUsed: 90, xMonthlyUsed: 200, claudeDailyRequests: 0 }, soft, 20);
    expect(d.allowed).toBe(true);
    expect(d.warning).toBe(true);
  });

  it("caps claude daily requests", () => {
    const d = checkClaudeBudget({ xDailyUsed: 0, xMonthlyUsed: 0, claudeDailyRequests: 10 }, limits);
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe("claude_daily");
  });

  it("computes utilization", () => {
    expect(budgetUtilization(50, 100)).toBe(0.5);
    expect(budgetUtilization(150, 100)).toBe(1);
    expect(budgetUtilization(5, 0)).toBe(0);
  });
});

describe("score bands", () => {
  it("maps scores to bands", () => {
    expect(bandForScore(10)).toBe("discard");
    expect(bandForScore(50)).toBe("archive");
    expect(bandForScore(70)).toBe("digest");
    expect(bandForScore(80)).toBe("priority");
    expect(bandForScore(95)).toBe("alert");
  });
});

describe("scheduling", () => {
  const now = Date.parse("2026-07-07T12:00:00Z");
  it("is due when never run and enabled", () => {
    expect(isMonitorDue({ enabled: true, pollIntervalMinutes: 60, lastRunAt: null }, now)).toBe(true);
  });
  it("is not due when disabled", () => {
    expect(isMonitorDue({ enabled: false, pollIntervalMinutes: 60, lastRunAt: null }, now)).toBe(false);
  });
  it("is not due within interval", () => {
    const last = new Date(now - 30 * 60_000).toISOString();
    expect(isMonitorDue({ enabled: true, pollIntervalMinutes: 60, lastRunAt: last }, now)).toBe(false);
  });
  it("is due after interval elapses", () => {
    const last = new Date(now - 61 * 60_000).toISOString();
    expect(isMonitorDue({ enabled: true, pollIntervalMinutes: 60, lastRunAt: last }, now)).toBe(true);
  });
  it("never runs an in-flight monitor", () => {
    expect(isMonitorDue({ enabled: true, pollIntervalMinutes: 60, lastRunAt: null, running: true }, now)).toBe(false);
  });
  it("converts 08:00 Asia/Kolkata to 02:30 UTC", () => {
    expect(localTimeToUtcMinutes(8, 0, ASIA_KOLKATA_OFFSET_MINUTES)).toBe(150); // 02:30 UTC
  });
});

describe("pricing", () => {
  it("estimates claude + x cost", () => {
    const p = pricingFromEnv(loadEnv({ CLAUDE_INPUT_COST_PER_MILLION: "3", CLAUDE_OUTPUT_COST_PER_MILLION: "15" }));
    expect(estimateClaudeCost(p, 1_000_000, 1_000_000)).toBe(18);
    const px = pricingFromEnv(loadEnv({ X_POST_READ_UNIT_COST_USD: "0.01" }));
    expect(estimateXCost(px, 100)).toBe(1);
  });
});
