import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { listLogs } from "@/lib/db/store";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ logs: await listLogs(userId) });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}
