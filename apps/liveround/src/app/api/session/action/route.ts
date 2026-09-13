import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { heartbeat, pauseRound, resumeRound, startRound, stopRound } from "@/lib/session/engine";
import type { Network } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json()) as {
      action: "start" | "pause" | "resume" | "stop" | "heartbeat";
      campaignId?: string;
      networks?: Network[];
      elapsedMs?: number;
      activity?: boolean;
    };
    if (body.action === "start") {
      if (!body.campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
      return NextResponse.json(await startRound({ userId, campaignId: body.campaignId, networks: body.networks ?? ["x"] }));
    }
    if (body.action === "pause") return NextResponse.json(await pauseRound(userId, "user"));
    if (body.action === "resume") return NextResponse.json(await resumeRound(userId));
    if (body.action === "stop") return NextResponse.json(await stopRound(userId));
    if (body.action === "heartbeat") {
      return NextResponse.json(await heartbeat(userId, body.elapsedMs ?? 2000, Boolean(body.activity)));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    const status = message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
