import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { getWriting, listAccounts, listLogs, saveAccount, saveUser, saveWriting, getUserById } from "@/lib/db/store";

export async function GET() {
  try {
    const userId = await requireUserId();
    const [user, writing, accounts, logs] = await Promise.all([
      getUserById(userId),
      getWriting(userId),
      listAccounts(userId),
      listLogs(userId),
    ]);
    return NextResponse.json({ user, writing, accounts, logs });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json()) as {
      bio?: string;
      writingNotes?: string;
      replyLength?: number;
      name?: string;
    };
    const writing = await getWriting(userId);
    writing.bio = body.bio ?? writing.bio;
    writing.writingNotes = body.writingNotes ?? writing.writingNotes;
    if (typeof body.replyLength === "number") writing.replyLength = Math.max(0, Math.min(100, body.replyLength));
    await saveWriting(writing);
    const user = await getUserById(userId);
    if (user && body.name !== undefined) {
      user.name = body.name;
      await saveUser(user);
    }
    const accounts = await listAccounts(userId);
    for (const account of accounts) {
      account.voiceProfile = {
        ...account.voiceProfile,
        bio: writing.bio,
        writingNotes: writing.writingNotes,
        replyLength: writing.replyLength,
      };
      await saveAccount(account);
    }
    return NextResponse.json({ ok: true, writing, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
