import Stripe from "stripe";
import { env, stripeConfigured } from "@/lib/env";
import type { BillingSku } from "./catalog";
import { PACKS, PLANS } from "./catalog";

let client: Stripe | null = null;

export function stripeClient(): Stripe | null {
  if (!stripeConfigured()) return null;
  if (!client) client = new Stripe(env.stripeSecret!);
  return client;
}

export function priceIdForSku(sku: BillingSku): string | undefined {
  const map: Record<BillingSku, string | undefined> = {
    scout_month: env.stripePrices.scoutMonth,
    scout_year: env.stripePrices.scoutYear,
    hunter_month: env.stripePrices.hunterMonth,
    hunter_year: env.stripePrices.hunterYear,
    apex_month: env.stripePrices.apexMonth,
    apex_year: env.stripePrices.apexYear,
    pack_50: env.stripePrices.pack50,
    pack_200: env.stripePrices.pack200,
    pack_500: env.stripePrices.pack500,
    pack_1800: env.stripePrices.pack1800,
  };
  return map[sku];
}

export function isPlanSku(sku: string): sku is BillingSku {
  return (
    PLANS.some((p) => sku === `${p.id}_month` || sku === `${p.id}_year`) || PACKS.some((p) => p.sku === sku)
  );
}
