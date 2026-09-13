import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { IDEA_DISTILL_MIN_REPLIES, X_CHAR_LIMIT } from "@/lib/types";
import { getIdea, getPosting, listIdeas, saveIdea, savePosting } from "@/lib/db/store-phase2";
import { assignSlot, normalizePosting } from "@/lib/ideas/schedule";
import { clamp } from "@/lib/utils";

export async function GET() {
  try {
    const userId = await requireUserId();
    const [ideas, posting] = await Promise.all([listIdeas(userId), getPosting(userId)]);
    return NextResponse.json({
      ideas,
      posting,
      distillMin: IDEA_DISTILL_MIN_REPLIES,
    });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json()) as {
      ideaId?: string;
      text?: string;
      action?: "save" | "approve" | "drop";
      posting?: { postsPerDay?: number; windowStart?: string; windowEnd?: string; timezone?: string };
    };
    if (body.posting) {
      const current = await getPosting(userId);
      const next = normalizePosting({
        userId,
        postsPerDay: body.posting.postsPerDay ?? current.postsPerDay,
        windowStart: body.posting.windowStart ?? current.windowStart,
        windowEnd: body.posting.windowEnd ?? current.windowEnd,
        timezone: body.posting.timezone ?? current.timezone,
      });
      await savePosting(next);
      return NextResponse.json({ posting: next });
    }
    if (!body.ideaId) return NextResponse.json({ error: "ideaId required" }, { status: 400 });
    const idea = await getIdea(body.ideaId);
    if (!idea || idea.userId !== userId) return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    if (typeof body.text === "string") idea.text = body.text.trim().slice(0, X_CHAR_LIMIT);
    if (body.action === "drop") {
      idea.status = "expired";
      await saveIdea(idea);
      return NextResponse.json({ idea });
    }
    if (body.action === "approve") {
      if (!idea.text.trim()) return NextResponse.json({ error: "Approve the exact text first." }, { status: 400 });
      const posting = await getPosting(userId);
      const occupied = (await listIdeas(userId))
        .filter((i) => i.id !== idea.id && (i.status === "approved" || i.status === "queued") && i.scheduledAt)
        .map((i) => i.scheduledAt!);
      const queued = assignSlot(idea, posting, occupied);
      await saveIdea(queued);
      return NextResponse.json({ idea: queued });
    }
    await saveIdea(idea);
    return NextResponse.json({ idea });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 400 });
  }
}
