import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { volumeForQuery } from "@/lib/x/volume";
import { resolveXSearchToken } from "@/lib/x/tokens";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json()) as { query?: string };
    const query = (body.query ?? "").trim();
    const token = await resolveXSearchToken(userId);
    const report = await volumeForQuery(query, token);
    const status = report.retryable ? 503 : 200;
    return NextResponse.json(report, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Volume check failed";
    const status = message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json({ error: message, retryable: false }, { status });
  }
}
