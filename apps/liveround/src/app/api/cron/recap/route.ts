import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/env";
import { listAllUsers, listLogs, saveUser, activeSessionForUser, getCampaign } from "@/lib/db/store";
import { listIdeas } from "@/lib/db/store-phase2";
import { missedQueueEmail, recapEmail, sendEmail } from "@/lib/mail/recap";
import { balanceOf } from "@/lib/credits";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const day = new Date().toISOString().slice(0, 10);
  const users = await listAllUsers();
  let sent = 0;
  for (const user of users) {
    if (user.lastRecapOn === day) continue;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const logs = (await listLogs(user.id)).filter((l) => Date.parse(l.confirmedAt) >= since);
    const posted = (await listIdeas(user.id)).filter((i) => i.postedAt && Date.parse(i.postedAt) >= since);
    const recap = recapEmail({
      replies: logs.length,
      posted: posted.length,
      credits: balanceOf(user).total,
    });
    const ok = await sendEmail({ to: user.email, subject: recap.subject, text: recap.text });
    const session = await activeSessionForUser(user.id);
    if (session && session.state !== "live" && session.queueCount > 0) {
      const campaign = await getCampaign(session.campaignId);
      const missed = missedQueueEmail({
        count: session.queueCount,
        topic: campaign?.reaching?.split(/[,.]/)[0]?.trim() || campaign?.name || "your campaign",
      });
      await sendEmail({ to: user.email, subject: missed.subject, text: missed.text });
    }
    if (ok) {
      user.lastRecapOn = day;
      await saveUser(user);
      sent += 1;
    }
  }
  return NextResponse.json({ users: users.length, sent });
}

export const POST = GET;
