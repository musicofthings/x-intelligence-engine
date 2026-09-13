import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { redditAdapter } from "@/lib/adapters";

export async function POST(req: Request) {
  try {
    await requireUserId();
    const body = (await req.json()) as { name?: string };
    const sub = await redditAdapter.validateTarget(body.name ?? "");
    return NextResponse.json({ subreddit: sub });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not validate subreddit";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
