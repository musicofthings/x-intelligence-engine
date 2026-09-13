import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { generateDraft } from "@/lib/ai/draft";
import { checkReply } from "@/lib/writing/safety";
import { charLimitFor } from "@/lib/send/compose";
import {
  getAccount,
  getCampaign,
  getCard,
  getSession,
  getWriting,
  listLogs,
  saveBlock,
  saveCard,
  saveLog,
  saveSession,
} from "@/lib/db/store";
import { newId, nowIso } from "@/lib/utils";
import { snapshotFor } from "@/lib/session/engine";
import type { DraftJob } from "@/lib/ai/draft";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const card = await getCard(id);
    if (!card || card.userId !== userId) return NextResponse.json({ error: "Card not found" }, { status: 404 });
    const body = (await req.json()) as {
      action: "pass" | "reply" | "confirm" | "block" | "block24" | "rewrite" | "save-draft" | "like" | "vote" | "dm";
      draft?: string;
      job?: DraftJob;
      note?: string;
      untilHours?: number;
    };

    if (body.action === "save-draft" && typeof body.draft === "string") {
      card.draft = body.draft;
      await saveCard(card);
      return NextResponse.json({ card });
    }

    if (body.action === "rewrite") {
      const campaign = await getCampaign(card.campaignId);
      const writing = await getWriting(userId);
      const session = await getSession(card.sessionId);
      const acting = session ? await getAccount(session.actingAccountId) : null;
      if (!campaign) return NextResponse.json({ error: "Campaign missing" }, { status: 400 });
      card.draft = await generateDraft({
        post: card.post,
        campaign,
        voice: acting?.voiceProfile ?? {
          bio: writing.bio,
          writingNotes: writing.writingNotes,
          replyLength: writing.replyLength,
          samplePosts: [],
        },
        writing,
        currentDraft: body.draft ?? card.draft,
        job: body.job ?? "rewrite",
        note: body.note,
      });
      await saveCard(card);
      return NextResponse.json({ card });
    }

    if (body.action === "pass") {
      card.status = "passed";
      card.draft = "";
      card.actedAt = nowIso();
      await saveCard(card);
      return NextResponse.json(await snapshotFor(userId));
    }

    if (body.action === "block" || body.action === "block24") {
      card.status = "blocked";
      card.actedAt = nowIso();
      await saveCard(card);
      await saveBlock({
        id: newId("blk"),
        userId,
        network: card.post.network,
        handle: card.post.authorHandle,
        until: body.action === "block24" ? new Date(Date.now() + 24 * 3600_000).toISOString() : null,
        createdAt: nowIso(),
      });
      return NextResponse.json(await snapshotFor(userId));
    }

    if (body.action === "confirm") {
      const draft = (body.draft ?? card.draft).trim();
      const logs = await listLogs(userId);
      const safety = checkReply(draft, {
        maxChars: charLimitFor(card.post.network),
        recentReplies: logs.map((l) => l.body),
      });
      if (!safety.sendable) return NextResponse.json({ error: "Draft is empty.", safety }, { status: 400 });
      await saveLog({
        id: newId("log"),
        userId,
        sessionId: card.sessionId,
        cardId: card.id,
        network: card.post.network,
        externalPostId: card.post.id,
        body: draft,
        confirmedAt: nowIso(),
      });
      card.status = "replied";
      card.draft = draft;
      card.actedAt = nowIso();
      await saveCard(card);
      const session = await getSession(card.sessionId);
      if (session) {
        session.repliesCount += 1;
        session.lastActivityAt = nowIso();
        await saveSession(session);
      }
      return NextResponse.json(await snapshotFor(userId));
    }

    if (body.action === "like" || body.action === "vote" || body.action === "dm") {
      return NextResponse.json({ ok: true, open: card.post.url });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 400 });
  }
}
