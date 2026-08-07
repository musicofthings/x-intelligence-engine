import { AppError, randomUrlSafe, sha256Base64Url } from "@xie/shared";

/**
 * X OAuth 2.0 Authorization Code flow with PKCE (spec §7.6) — the user-context auth
 * required to POST a reply. Distinct from the app-only bearer token used for reads.
 *
 * Only the `redirect_uri` we generate is ever accepted back; the code verifier never
 * leaves the server, and tokens are encrypted before they touch D1.
 */

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const REVOKE_URL = "https://api.x.com/2/oauth2/revoke";

/**
 * `offline.access` is what makes the refresh token available — without it the
 * connection silently dies after ~2 hours and every send starts failing.
 */
export const DEFAULT_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

export interface OAuthConfig {
  clientId: string;
  /** Set for confidential clients; omitted for public (PKCE-only) clients. */
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
  authorizeUrl?: string;
  tokenUrl?: string;
}

export interface PkceHandshake {
  url: string;
  state: string;
  codeVerifier: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  /** Absolute expiry, ISO-8601. */
  expiresAt: string | null;
  tokenType: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  token_type?: string;
}

/** Build the consent URL plus the state/verifier the callback must be matched against. */
export async function beginAuthorization(cfg: OAuthConfig): Promise<PkceHandshake> {
  requireConfig(cfg);
  const state = randomUrlSafe(24);
  const codeVerifier = randomUrlSafe(48);
  const challenge = await sha256Base64Url(codeVerifier);

  const url = new URL(cfg.authorizeUrl ?? AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", (cfg.scopes ?? DEFAULT_SCOPES).join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { url: url.toString(), state, codeVerifier };
}

export async function exchangeCode(
  cfg: OAuthConfig,
  params: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<TokenSet> {
  requireConfig(cfg);
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
  cfg: OAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<TokenSet> {
  requireConfig(cfg);
  if (!refreshToken) {
    throw new AppError("AUTHENTICATION_ERROR", "No refresh token stored — reconnect the X account");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  return postToken(cfg, body, fetchImpl, nowMs);
}

export async function revokeToken(
  cfg: OAuthConfig,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const doFetch = fetchImpl;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (cfg.clientSecret) headers.authorization = `Basic ${basicAuth(cfg.clientId, cfg.clientSecret)}`;
  await doFetch(REVOKE_URL, {
    method: "POST",
    headers,
    body: new URLSearchParams({ token, client_id: cfg.clientId, token_type_hint: "access_token" }).toString(),
  });
}

async function postToken(
  cfg: OAuthConfig,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<TokenSet> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  // Confidential clients must authenticate the token request; public ones must not.
  if (cfg.clientSecret) headers.authorization = `Basic ${basicAuth(cfg.clientId, cfg.clientSecret)}`;

  const doFetch = fetchImpl;
  const res = await doFetch(cfg.tokenUrl ?? TOKEN_URL, { method: "POST", headers, body: body.toString() });
  if (!res.ok) {
    const code = res.status === 400 || res.status === 401 ? "AUTHENTICATION_ERROR" : "X_API_ERROR";
    throw new AppError(code, "X OAuth token request failed", {
      detail: { status: res.status, body: await safeText(res) },
    });
  }
  const t = (await res.json()) as TokenResponse;
  if (!t.access_token) {
    throw new AppError("AUTHENTICATION_ERROR", "X returned no access token");
  }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    scope: t.scope ?? null,
    expiresAt: t.expires_in ? new Date(nowMs + t.expires_in * 1000).toISOString() : null,
    tokenType: t.token_type ?? "bearer",
  };
}

/** True when the token is expired or within `skewSeconds` of expiring. */
export function isExpired(expiresAt: string | null, nowMs: number, skewSeconds = 120): boolean {
  if (!expiresAt) return false; // no expiry recorded — let the API be the judge
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t - skewSeconds * 1000 <= nowMs;
}

function requireConfig(cfg: OAuthConfig): void {
  if (!cfg.clientId) throw new AppError("CONFIGURATION_ERROR", "X_OAUTH_CLIENT_ID is not set");
  if (!cfg.redirectUri) throw new AppError("CONFIGURATION_ERROR", "X OAuth redirect URI is not set");
}

function basicAuth(id: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${id}:${secret}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
