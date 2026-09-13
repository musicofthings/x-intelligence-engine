import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { PACKS, PLANS } from "@/lib/billing/catalog";
import { getUserById } from "@/lib/db/store";
import { appUrl, stripeConfigured } from "@/lib/env";
import { isPlanSku, priceIdForSku, stripeClient } from "@/lib/billing/stripe";
import type { BillingSku } from "@/lib/billing/catalog";

export async function GET() {
  try {
    const userId = await requireUserId();
    const user = await getUserById(userId);
    return NextResponse.json({
      configured: stripeConfigured(),
      user,
      plans: PLANS,
      packs: PACKS,
    });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 404 });
    const body = (await req.json()) as { sku?: string };
    const sku = body.sku ?? "";
    if (!isPlanSku(sku)) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    const stripe = stripeClient();
    if (!stripe) {
      return NextResponse.json(
        { error: "Stripe is not configured. The catalog is visible; charges are not faked." },
        { status: 400 },
      );
    }
    const price = priceIdForSku(sku as BillingSku);
    if (!price) {
      return NextResponse.json({ error: "This Stripe price is not configured yet." }, { status: 400 });
    }
    const pack = sku.startsWith("pack_");
    const session = await stripe.checkout.sessions.create({
      mode: pack ? "payment" : "subscription",
      customer: user.stripeCustomerId ?? undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items: [{ price, quantity: 1 }],
      success_url: `${appUrl()}/app/settings?billing=ok`,
      cancel_url: `${appUrl()}/app/settings?billing=cancel`,
      metadata: { userId, sku },
      subscription_data: pack ? undefined : { metadata: { userId, sku } },
    });
    if (!session.url) return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 400 });
  }
}
