import { authSecret, env } from "@/lib/env";
import { decryptSecret, encryptSecret, resolveTokenKey } from "@/lib/crypto";
import { getAccountTokenEnvelope, listAccounts, setAccountTokenEnvelope } from "@/lib/db/store";
import { beginAuthorization, isExpired, refreshAccessToken, type XOAuthConfig } from "@/lib/x/oauth";
import type { XTokenSet } from "@/lib/types";
import { xRedirectUri } from "@/lib/env";

export function xOAuthConfig(): XOAuthConfig {
  if (!env.xClientId) throw new Error("X_CLIENT_ID is not set");
  return {
    clientId: env.xClientId,
    clientSecret: env.xClientSecret,
    redirectUri: xRedirectUri(),
  };
}

async function key() {
  return resolveTokenKey(env.tokenKey, authSecret(), env.nodeEnv);
}

export async function encryptTokens(tokens: XTokenSet): Promise<string> {
  return encryptSecret(await key(), JSON.stringify(tokens));
}

export async function decryptTokens(envelope: string): Promise<XTokenSet> {
  return JSON.parse(await decryptSecret(await key(), envelope)) as XTokenSet;
}

export async function storeAccountTokens(accountId: string, tokens: XTokenSet): Promise<void> {
  await setAccountTokenEnvelope(accountId, await encryptTokens(tokens), tokens.expiresAt);
}

export async function resolveXSearchToken(userId: string, actingAccountId?: string | null): Promise<string | undefined> {
  const accounts = await listAccounts(userId);
  const preferred = actingAccountId ? accounts.find((a) => a.id === actingAccountId) : undefined;
  const xAccounts = [preferred, ...accounts.filter((a) => a.provider === "x" && a.status === "ok")].filter(Boolean);
  for (const account of xAccounts) {
    if (!account) continue;
    try {
      const token = await validAccessToken(account.id);
      if (token) return token;
    } catch {
      /* try next / bearer */
    }
  }
  return env.xBearer;
}

export async function validAccessToken(accountId: string, nowMs = Date.now()): Promise<string | null> {
  const envelope = await getAccountTokenEnvelope(accountId);
  if (!envelope) return null;
  let tokens = await decryptTokens(envelope);
  if (isExpired(tokens.expiresAt, nowMs) && tokens.refreshToken && env.xClientId) {
    tokens = await refreshAccessToken(xOAuthConfig(), tokens.refreshToken);
    await storeAccountTokens(accountId, tokens);
  }
  return tokens.accessToken;
}

export { beginAuthorization };
