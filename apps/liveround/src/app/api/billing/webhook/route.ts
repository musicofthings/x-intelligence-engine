import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { env, stripeConfigured } from "@/lib/env";
import { stripeClient, isPlanSku } from "@/lib/billing/stripe";
import { grantFromSku, markBillingPaused } from "@/lib/billing/entitlements";
import { getUserById, getUserByStripeCustomer } from "@/lib/db/store";
import { planById, type BillingSku } from "@/lib/billing/catalog";
import { applyPlanGrant } from "@/lib/billing/catalog";
import { saveUser } from "@/lib/db/store";
import { appendLedger } from "@/lib/db/store";
import { newId, nowIso } from "@/lib/utils";

export async function POST(req: Request) {
  if (!stripeConfigured() || !env.stripeWebhook) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 501 });
  }
  const stripe = stripeClient();
  if (!stripe) return NextResponse.json({ error: "Stripe is not configured" }, { status: 501 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.stripeWebhook);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.userId ?? "";
    const sku = session.metadata?.sku ?? "";
    const user = userId ? await getUserById(userId) : null;
    if (user && isPlanSku(sku)) {
      await grantFromSku(user, sku as BillingSku, {
        stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
        stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
        periodEnd: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      });
    }
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object;
    const customer = typeof invoice.customer === "string" ? invoice.customer : "";
    const user = customer ? await getUserByStripeCustomer(customer) : null;
    const plan = user ? planById(user.plan) : undefined;
    if (user && plan && invoice.billing_reason === "subscription_cycle") {
      const next = applyPlanGrant(user, plan, user.planPeriodEnd);
      await saveUser(next);
      await appendLedger({
        id: newId("led"),
        userId: user.id,
        sessionId: null,
        intervalId: `plan_cycle:${invoice.id}`,
        pool: "plan",
        delta: plan.credits,
        reason: "plan_reset",
        createdAt: nowIso(),
      });
    } else if (user && user.billingPaused) {
      user.billingPaused = false;
      await saveUser(user);
    }
  }

  if (event.type === "invoice.payment_failed" || event.type === "customer.subscription.deleted") {
    const obj = event.data.object as { customer?: unknown; metadata?: { userId?: string } };
    const userId = obj.metadata?.userId;
    const customer = typeof obj.customer === "string" ? obj.customer : "";
    const user = userId ? await getUserById(userId) : customer ? await getUserByStripeCustomer(customer) : null;
    if (user) await markBillingPaused(user);
  }

  return NextResponse.json({ received: true });
}
