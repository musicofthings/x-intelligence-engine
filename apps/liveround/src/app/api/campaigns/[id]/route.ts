import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { deleteCampaign, getAccount, getCampaign, listAccounts, saveCampaign } from "@/lib/db/store";
import { nowIso } from "@/lib/utils";
import type { Campaign } from "@/lib/types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const campaign = await getCampaign(id);
    if (!campaign || campaign.userId !== userId) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json({ campaign });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const existing = await getCampaign(id);
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const body = (await req.json()) as Partial<Campaign> & { actingAccountId?: string };
    if (body.actingAccountId) {
      const account = await getAccount(body.actingAccountId);
      if (!account || account.userId !== userId) {
        return NextResponse.json({ error: "Unknown acting account." }, { status: 400 });
      }
    } else {
      const accounts = await listAccounts(userId);
      if (!accounts.some((a) => a.id === existing.actingAccountId) && accounts[0]) {
        existing.actingAccountId = accounts[0].id;
      }
    }
    const campaign: Campaign = {
      ...existing,
      name: body.name?.trim() || existing.name,
      actingAccountId: body.actingAccountId ?? existing.actingAccountId,
      building: body.building ?? existing.building,
      reaching: body.reaching ?? existing.reaching,
      strategyX: body.strategyX ?? existing.strategyX,
      strategyReddit: body.strategyReddit ?? existing.strategyReddit,
      filterDoc: body.filterDoc ?? existing.filterDoc,
      searchRules: body.searchRules ?? existing.searchRules,
      subreddits: body.subreddits ?? existing.subreddits,
      minFollowers:
        typeof body.minFollowers === "number" ? Math.max(0, Math.round(body.minFollowers)) : existing.minFollowers,
      updatedAt: nowIso(),
    };
    await saveCampaign(campaign);
    return NextResponse.json({ campaign });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const result = await deleteCampaign(id, userId);
    if (!result.ok) {
      const status = result.error === "Campaign not found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}
