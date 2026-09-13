import { describe, expect, it } from "vitest";
import { accountCap, applyPackGrant, applyPlanGrant, startBlockedReason, trialExpired } from "./catalog";
import { TRIAL_DAYS, type UserRecord } from "@/lib/types";
import { PLANS, PACKS } from "./catalog";

const user = (over: Partial<UserRecord> = {}): UserRecord => ({
  id: "usr_1",
  email: "a@b.c",
  name: null,
  image: null,
  createdAt: new Date().toISOString(),
  plan: "trial",
  trialStartedAt: new Date().toISOString(),
  planCredits: 50,
  permanentCredits: 0,
  onboardingComplete: true,
  billingPaused: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  planPeriodEnd: null,
  lastRecapOn: null,
  ...over,
});

describe("billing catalog", () => {
  it("matches the published prices", () => {
    expect(PLANS.find((p) => p.id === "scout")).toMatchObject({ monthlyUsd: 39, yearlyUsd: 384, credits: 300, accounts: 2 });
    expect(PLANS.find((p) => p.id === "hunter")).toMatchObject({ monthlyUsd: 69, yearlyUsd: 684, credits: 750 });
    expect(PLANS.find((p) => p.id === "apex")).toMatchObject({ monthlyUsd: 149, yearlyUsd: 1488, credits: 2000 });
    expect(PACKS.map((p) => p.usd)).toEqual([9, 29, 69, 199]);
  });

  it("blocks starts when billing is paused or the trial ended", () => {
    expect(startBlockedReason(user({ billingPaused: true }))).toMatch(/paused/i);
    const old = user({ trialStartedAt: new Date(Date.now() - (TRIAL_DAYS + 1) * 86400000).toISOString() });
    expect(trialExpired(old)).toBe(true);
    expect(startBlockedReason(old)).toMatch(/trial/i);
    expect(startBlockedReason(user())).toBeNull();
  });

  it("grants plan credits and permanent packs separately", () => {
    const scout = PLANS[0]!;
    const next = applyPlanGrant(user(), scout, null);
    expect(next.plan).toBe("scout");
    expect(next.planCredits).toBe(300);
    const packed = applyPackGrant(next, PACKS[0]!);
    expect(packed.permanentCredits).toBe(50);
    expect(packed.planCredits).toBe(300);
    expect(accountCap("apex")).toBe(10);
  });
});
