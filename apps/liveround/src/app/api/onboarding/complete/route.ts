import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { getUserById, listCampaigns, saveUser } from "@/lib/db/store";

export async function POST() {
  try {
    const userId = await requireUserId();
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 404 });
    const campaigns = await listCampaigns(userId);
    if (campaigns.length === 0) {
      return NextResponse.json({ error: "Finish a campaign first." }, { status: 400 });
    }
    user.onboardingComplete = true;
    await saveUser(user);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
}
