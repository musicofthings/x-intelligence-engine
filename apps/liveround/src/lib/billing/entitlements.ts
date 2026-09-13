import type { BillingSku, PlanCatalog } from "./catalog";
import { applyPackGrant, applyPlanGrant, packBySku, planById, skuToPlan } from "./catalog";
import type { UserRecord } from "@/lib/types";
import { appendLedger, saveUser } from "@/lib/db/store";
import { newId, nowIso } from "@/lib/utils";

export async function grantFromSku(
  user: UserRecord,
  sku: BillingSku,
  extras: { stripeCustomerId?: string; stripeSubscriptionId?: string; periodEnd?: string | null },
): Promise<UserRecord> {
  const parsed = skuToPlan(sku);
  let next = { ...user };
  if (extras.stripeCustomerId) next.stripeCustomerId = extras.stripeCustomerId;
  if (extras.stripeSubscriptionId) next.stripeSubscriptionId = extras.stripeSubscriptionId;
  if (parsed.plan) {
    next = applyPlanGrant(next, parsed.plan, extras.periodEnd ?? null);
    await appendLedger({
      id: newId("led"),
      userId: user.id,
      sessionId: null,
      intervalId: `plan:${sku}:${extras.periodEnd ?? nowIso()}`,
      pool: "plan",
      delta: parsed.plan.credits,
      reason: "plan_reset",
      createdAt: nowIso(),
    });
  } else if (parsed.pack) {
    next = applyPackGrant(next, parsed.pack);
    await appendLedger({
      id: newId("led"),
      userId: user.id,
      sessionId: null,
      intervalId: `pack:${sku}:${nowIso()}`,
      pool: "permanent",
      delta: parsed.pack.credits,
      reason: "pack",
      createdAt: nowIso(),
    });
  }
  await saveUser(next);
  return next;
}

export async function markBillingPaused(user: UserRecord): Promise<UserRecord> {
  const next = { ...user, billingPaused: true };
  await saveUser(next);
  return next;
}

export async function grantPlanDirect(user: UserRecord, plan: PlanCatalog, periodEnd: string | null): Promise<UserRecord> {
  return grantFromSku(user, `${plan.id}_month` as BillingSku, { periodEnd });
}

export { planById, packBySku };
