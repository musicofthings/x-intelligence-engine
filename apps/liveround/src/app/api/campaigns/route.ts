import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { getAccount, listAccounts, listCampaigns, saveCampaign } from "@/lib/db/store";
import { newId, nowIso } from "@/lib/utils";
import type { Campaign, Network } from "@/lib/types";
import { previewPosts } from "@/lib/session/engine";
import { thinkForMe } from "@/lib/ai/draft";
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ campaigns: await listCampaigns(userId) });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json()) as Partial<Campaign> & {
      think?: boolean;
      site?: string;
      previewNetworks?: Network[];
    };
    const accounts = await listAccounts(userId);
    const acting = body.actingAccountId
      ? await getAccount(body.actingAccountId)
      : accounts[0];
    if (!acting || acting.userId !== userId) {
      return NextResponse.json({ error: "Connect an acting account first." }, { status: 400 });
    }
    let generated = null;
    if (body.think) {
      generated = await thinkForMe(body.building ?? "", body.reaching ?? "", body.site);
    }
    const campaign: Campaign = {
      id: body.id ?? newId("cmp"),
      userId,
      name: body.name || generated?.name || (body.building?.split(/[,.]/)[0]?.trim() || "Primary"),
      actingAccountId: acting.id,
      building: body.building ?? "",
      reaching: body.reaching ?? "",
      strategyX: body.strategyX ?? generated?.strategyX ?? "",
      strategyReddit: body.strategyReddit ?? generated?.strategyReddit ?? "",
      filterDoc: body.filterDoc ?? generated?.filterDoc ?? "",
      searchRules: body.searchRules ?? generated?.searchRules ?? [],
      subreddits: body.subreddits ?? generated?.subreddits ?? [],
      minFollowers: typeof body.minFollowers === "number" ? Math.max(0, Math.round(body.minFollowers)) : 0,
      createdAt: body.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    await saveCampaign(campaign);
    const preview = await previewPosts(campaign, body.previewNetworks ?? ["x", "reddit"]);
    return NextResponse.json({ campaign, preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 400 });
  }
}
