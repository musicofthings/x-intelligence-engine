import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { snapshotFor } from "@/lib/session/engine";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await snapshotFor(userId));
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}
