import { NextResponse } from "next/server";
import { appUrl } from "@/auth";
import { getUserById, listAccounts, saveAccount } from "@/lib/db/store";
import { consumeOAuthState } from "@/lib/db/store-phase2";
import { exchangeCode } from "@/lib/x/oauth";
import { storeAccountTokens, xOAuthConfig } from "@/lib/x/tokens";
import { usersMe } from "@/lib/x/search";
import { newId, nowIso } from "@/lib/utils";
import { getWriting } from "@/lib/db/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const settings = new URL("/app/settings", appUrl());
  if (err || !code || !state) {
    settings.searchParams.set("oauth", "denied");
    return NextResponse.redirect(settings);
  }
  const stored = await consumeOAuthState(state);
  if (!stored || stored.provider !== "x") {
    settings.searchParams.set("oauth", "expired");
    return NextResponse.redirect(settings);
  }
  try {
    const tokens = await exchangeCode(xOAuthConfig(), { code, codeVerifier: stored.verifier });
    const me = await usersMe(tokens.accessToken);
    const user = await getUserById(stored.userId);
    if (!user) throw new Error("Unknown user");
    const writing = await getWriting(stored.userId);
    const accounts = await listAccounts(stored.userId);
    const existing = accounts.find((a) => a.provider === "x" && a.handle.toLowerCase() === me.username.toLowerCase());
    const account = existing ?? {
      id: newId("soc"),
      userId: stored.userId,
      provider: "x" as const,
      handle: me.username,
      displayName: `@${me.username}`,
      status: "ok" as const,
      scopes: tokens.scope?.split(" ") ?? [],
      voiceProfile: {
        bio: writing.bio,
        writingNotes: writing.writingNotes,
        replyLength: writing.replyLength,
        samplePosts: [],
      },
      activeSessionId: null,
      tokenExpiresAt: tokens.expiresAt,
      createdAt: nowIso(),
    };
    account.handle = me.username;
    account.displayName = me.name ? `${me.name} (@${me.username})` : `@${me.username}`;
    account.status = "ok";
    account.scopes = tokens.scope?.split(" ") ?? account.scopes;
    account.tokenExpiresAt = tokens.expiresAt;
    await saveAccount(account);
    await storeAccountTokens(account.id, tokens);
    settings.searchParams.set("oauth", "ok");
    return NextResponse.redirect(settings);
  } catch {
    settings.searchParams.set("oauth", "failed");
    return NextResponse.redirect(settings);
  }
}
