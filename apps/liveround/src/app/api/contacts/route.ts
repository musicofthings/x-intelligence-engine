import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { productActive } from "@/lib/billing/catalog";
import { getUserById, listLogs } from "@/lib/db/store";
import { listContacts } from "@/lib/db/store-phase2";
import { contactsFromLogs, persistContacts } from "@/lib/contacts/score";
import { recentSearch, tweetsToPosts } from "@/lib/x/search";
import { resolveXSearchToken } from "@/lib/x/tokens";
import { listAccounts } from "@/lib/db/store";

export async function GET() {
  try {
    const userId = await requireUserId();
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 404 });
    const unlocked = productActive(user);
    if (!unlocked) {
      return NextResponse.json({ unlocked: false, contacts: [], message: "Contacts are part of the live trial and paid plans." });
    }
    const logs = await listLogs(userId);
    const inbound = await fetchInbound(userId);
    const computed = contactsFromLogs(userId, logs, inbound);
    await persistContacts(computed);
    const contacts = await listContacts(userId);
    return NextResponse.json({ unlocked: true, contacts });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}

async function fetchInbound(userId: string): Promise<{ network: "x"; handle: string; at: string }[]> {
  const accounts = await listAccounts(userId);
  const ours = accounts.find((a) => a.provider === "x" && a.status === "ok");
  if (!ours) return [];
  const token = await resolveXSearchToken(userId, ours.id);
  if (!token) return [];
  try {
    const body = await recentSearch(token, {
      query: `to:${ours.handle} -is:retweet`,
      maxResults: 100,
      startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    return tweetsToPosts(body).map((p) => ({ network: "x" as const, handle: p.authorHandle, at: p.createdAt }));
  } catch {
    return [];
  }
}
