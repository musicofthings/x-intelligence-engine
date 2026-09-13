import { NextResponse } from "next/server";
import { requireUserId } from "@/auth";
import { xConfigured } from "@/lib/env";
import { accountCap } from "@/lib/billing/catalog";
import { getUserById, listAccounts } from "@/lib/db/store";
import { saveOAuthState } from "@/lib/db/store-phase2";
import { beginAuthorization, xOAuthConfig } from "@/lib/x/tokens";

export async function GET() {
  try {
    const userId = await requireUserId();
    if (!xConfigured()) {
      return NextResponse.json(
        { error: "X_CLIENT_ID and X_CLIENT_SECRET are not set. The mock adapter stays on." },
        { status: 400 },
      );
    }
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 404 });
    const real = (await listAccounts(userId)).filter((a) => a.provider === "x" || a.provider === "reddit");
    if (real.length >= accountCap(user.plan)) {
      return NextResponse.json(
        { error: `This plan allows ${accountCap(user.plan)} connected social accounts.` },
        { status: 400 },
      );
    }
    const handshake = await beginAuthorization(xOAuthConfig());
    await saveOAuthState({
      state: handshake.state,
      userId,
      provider: "x",
      codeVerifier: handshake.codeVerifier,
      expiresAt: Date.now() + 10 * 60_000,
    });
    return NextResponse.redirect(handshake.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth start failed";
    const status = message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
