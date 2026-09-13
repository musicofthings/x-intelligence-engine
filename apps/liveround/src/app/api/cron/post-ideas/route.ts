import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/env";
import { expireStaleIdeas, listDueIdeas, saveIdea } from "@/lib/db/store-phase2";
import { listAccounts, saveAccount } from "@/lib/db/store";
import { publishOriginalPost } from "@/lib/ideas/publish";
import { validAccessToken } from "@/lib/x/tokens";
import { nowIso } from "@/lib/utils";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expired = await expireStaleIdeas();
  const due = await listDueIdeas();
  let posted = 0;
  let failed = 0;
  for (const idea of due) {
    idea.status = "queued";
    await saveIdea(idea);
    const accounts = await listAccounts(idea.userId);
    const xAccount = accounts.find((a) => a.provider === "x" && a.status === "ok");
    const token = xAccount ? await validAccessToken(xAccount.id) : null;
    if (!token) {
      idea.status = "failed";
      idea.failReason = "X is not connected — LiveRound cannot publish original posts without OAuth.";
      await saveIdea(idea);
      failed += 1;
      continue;
    }
    try {
      const published = await publishOriginalPost(token, idea.text);
      idea.status = "posted";
      idea.postedAt = nowIso();
      idea.externalPostId = published.id;
      idea.failReason = null;
      posted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publish failed";
      if (/expired|401|403|Reconnect/i.test(message)) {
        idea.status = "failed";
        idea.failReason = message;
        if (xAccount) {
          xAccount.status = "expired";
          await saveAccount(xAccount);
        }
        failed += 1;
      } else {
        idea.status = "queued";
        idea.failReason = message;
      }
    }
    await saveIdea(idea);
  }
  return NextResponse.json({ expired, due: due.length, posted, failed });
}

export const POST = GET;
