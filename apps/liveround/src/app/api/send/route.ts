import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { buildReplySend } from "@/lib/send/compose";
import { checkReply } from "@/lib/writing/safety";
import { charLimitFor } from "@/lib/send/compose";
import { getCard, listLogs } from "@/lib/db/store";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json()) as { cardId?: string; draft?: string };
    const card = body.cardId ? await getCard(body.cardId) : null;
    if (!card || card.userId !== userId) return NextResponse.json({ error: "Card not found" }, { status: 404 });
    const draft = (body.draft ?? card.draft).trim();
    const logs = await listLogs(userId);
    const safety = checkReply(draft, {
      maxChars: charLimitFor(card.post.network),
      recentReplies: logs.map((l) => l.body),
    });
    const send = buildReplySend(card.post, draft, req.headers.get("user-agent") ?? "");
    return NextResponse.json({ send, safety });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}
