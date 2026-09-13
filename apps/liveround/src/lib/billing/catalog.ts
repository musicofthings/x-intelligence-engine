import type { PlanId, UserRecord } from "@/lib/types";
import { TRIAL_DAYS } from "@/lib/types";

export type PlanSku = "scout_month" | "scout_year" | "hunter_month" | "hunter_year" | "apex_month" | "apex_year";
export type PackSku = "pack_50" | "pack_200" | "pack_500" | "pack_1800";
export type BillingSku = PlanSku | PackSku;

export interface PlanCatalog {
  id: Exclude<PlanId, "trial" | "paused">;
  name: string;
  monthlyUsd: number;
  yearlyUsd: number;
  credits: number;
  accounts: number;
  blurb: string;
}

export interface PackCatalog {
  sku: PackSku;
  credits: number;
  usd: number;
}

export const PLANS: PlanCatalog[] = [
  { id: "scout", name: "Scout", monthlyUsd: 39, yearlyUsd: 384, credits: 300, accounts: 2, blurb: "1 X + 1 Reddit. The daily loop." },
  { id: "hunter", name: "Hunter", monthlyUsd: 69, yearlyUsd: 684, credits: 750, accounts: 5, blurb: "Five connected accounts. Priority when the queue is busy." },
  { id: "apex", name: "Apex", monthlyUsd: 149, yearlyUsd: 1488, credits: 2000, accounts: 10, blurb: "Ten accounts. Room for a small team of acting identities." },
];

export const PACKS: PackCatalog[] = [
  { sku: "pack_50", credits: 50, usd: 9 },
  { sku: "pack_200", credits: 200, usd: 29 },
  { sku: "pack_500", credits: 500, usd: 69 },
  { sku: "pack_1800", credits: 1800, usd: 199 },
];

export function planById(id: string): PlanCatalog | undefined {
  return PLANS.find((p) => p.id === id);
}

export function packBySku(sku: string): PackCatalog | undefined {
  return PACKS.find((p) => p.sku === sku);
}

export function skuToPlan(sku: BillingSku): { plan?: PlanCatalog; interval?: "month" | "year"; pack?: PackCatalog } {
  if (sku.startsWith("pack_")) return { pack: packBySku(sku) };
  const [planId, interval] = sku.split("_") as [PlanCatalog["id"], "month" | "year"];
  return { plan: planById(planId), interval };
}

export function accountCap(plan: PlanId): number {
  if (plan === "apex") return 10;
  if (plan === "hunter") return 5;
  return 2;
}

export function trialExpired(user: UserRecord, now = Date.now()): boolean {
  if (user.plan !== "trial") return false;
  const start = Date.parse(user.trialStartedAt);
  if (!Number.isFinite(start)) return true;
  return now > start + TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

export function productActive(user: UserRecord, now = Date.now()): boolean {
  if (user.billingPaused) return false;
  if (user.plan === "paused") return false;
  if (user.plan === "trial") return !trialExpired(user, now);
  return user.plan === "scout" || user.plan === "hunter" || user.plan === "apex";
}

export function startBlockedReason(user: UserRecord, now = Date.now()): string | null {
  if (user.billingPaused) {
    return "Billing is paused after a failed payment. Update the card in Settings to continue.";
  }
  if (trialExpired(user, now) && user.plan === "trial") {
    return "The trial has ended. Pick Scout, Hunter, or Apex to keep running rounds.";
  }
  return null;
}

export function applyPlanGrant(user: UserRecord, plan: PlanCatalog, periodEnd: string | null): UserRecord {
  return {
    ...user,
    plan: plan.id,
    planCredits: plan.credits,
    billingPaused: false,
    planPeriodEnd: periodEnd,
  };
}

export function applyPackGrant(user: UserRecord, pack: PackCatalog): UserRecord {
  return {
    ...user,
    permanentCredits: user.permanentCredits + pack.credits,
  };
}
