import { randomUrlSafe, sha256Base64Url } from "@/lib/crypto";
import type { XTokenSet } from "@/lib/types";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";

/** tweet.write is for approved original Post Ideas only — never replies. */
export const X_OAUTH_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

export interface XOAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface PkceHandshake {
  url: string;
  state: string;
  codeVerifier: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  token_type?: string;
}

export async function beginAuthorization(cfg: XOAuthConfig): Promise<PkceHandshake> {
  if (!cfg.clientId) throw new Error("X_CLIENT_ID is not set");
  if (!cfg.redirectUri) throw new Error("X OAuth redirect URI is not set");
  const state = randomUrlSafe(24);
  const codeVerifier = randomUrlSafe(48);
  const challenge = await sha256Base64Url(codeVerifier);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", X_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, codeVerifier };
}

export async function exchangeCode(
  cfg: XOAuthConfig,
  params: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<XTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    code_verifier: params.codeVerifier,
  });
  return postToken(cfg, body, fetchImpl, nowMs);
}

export async function refreshAccessToken(
  cfg: XOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<XTokenSet> {
  if (!refreshToken) throw new Error("No refresh token stored — reconnect the X account");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  return postToken(cfg, body, fetchImpl, nowMs);
}

export function isExpired(expiresAt: string | null, nowMs: number, skewSeconds = 120): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t - skewSeconds * 1000 <= nowMs;
}

function basicAuth(id: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${id}:${secret}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function postToken(
  cfg: XOAuthConfig,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<XTokenSet> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (cfg.clientSecret) headers.authorization = `Basic ${basicAuth(cfg.clientId, cfg.clientSecret)}`;
  const res = await fetchImpl(TOKEN_URL, { method: "POST", headers, body: body.toString() });
  if (!res.ok) {
    throw new Error(`X OAuth token request failed (${res.status})`);
  }
  const t = (await res.json()) as TokenResponse;
  if (!t.access_token) throw new Error("X returned no access token");
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    scope: t.scope ?? null,
    expiresAt: t.expires_in ? new Date(nowMs + t.expires_in * 1000).toISOString() : null,
    tokenType: t.token_type ?? "bearer",
  };
}
