import { AppError } from "@xie/shared";

/**
 * Cloudflare Access JWT verification (spec §24), production-grade defense-in-depth.
 *
 * The worker does NOT trust the `Cf-Access-Authenticated-User-Email` header blindly.
 * It cryptographically verifies the `Cf-Access-Jwt-Assertion` (RS256) against the
 * team's public JWKS, checks the audience (AUD) tag, expiry, issuer, and the email
 * allow-list. This holds even if the worker is reachable directly (not only via Access).
 */

export interface Jwk {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}
export interface Jwks {
  keys: Jwk[];
}

interface JwtHeader {
  alg: string;
  kid: string;
  typ?: string;
}
interface JwtPayload {
  aud?: string | string[];
  email?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  identity_nonce?: string;
}

const encoder = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(s: string): T {
  const bytes = b64urlToBytes(s);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export interface VerifyOptions {
  jwks: Jwks;
  aud: string;
  issuer?: string;
  allowedEmails: string[];
  nowSec: number;
}

export interface VerifyResult {
  email: string;
}

/** Verify a Cloudflare Access JWT. Throws AppError on any failure. */
export async function verifyAccessJwt(token: string, opts: VerifyOptions): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AppError("AUTHENTICATION_ERROR", "Malformed Access token");
  const [rawHeader, rawPayload, rawSig] = parts as [string, string, string];

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = b64urlToJson<JwtHeader>(rawHeader);
    payload = b64urlToJson<JwtPayload>(rawPayload);
  } catch {
    throw new AppError("AUTHENTICATION_ERROR", "Unparseable Access token");
  }

  if (header.alg !== "RS256") throw new AppError("AUTHENTICATION_ERROR", "Unexpected token algorithm");

  const jwk = opts.jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AppError("AUTHENTICATION_ERROR", "Unknown signing key");

  // Verify RS256 signature over `header.payload`.
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = encoder.encode(`${rawHeader}.${rawPayload}`);
  const sig = b64urlToBytes(rawSig);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!valid) throw new AppError("AUTHENTICATION_ERROR", "Invalid Access token signature");

  // Claim checks.
  if (payload.exp !== undefined && opts.nowSec >= payload.exp) {
    throw new AppError("AUTHENTICATION_ERROR", "Access token expired");
  }
  if (payload.nbf !== undefined && opts.nowSec < payload.nbf) {
    throw new AppError("AUTHENTICATION_ERROR", "Access token not yet valid");
  }
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!auds.includes(opts.aud)) throw new AppError("AUTHORIZATION_ERROR", "Access token audience mismatch");
  if (opts.issuer && payload.iss !== opts.issuer) {
    throw new AppError("AUTHENTICATION_ERROR", "Access token issuer mismatch");
  }

  const email = payload.email?.toLowerCase();
  if (!email) throw new AppError("AUTHENTICATION_ERROR", "Access token missing email");
  if (opts.allowedEmails.length > 0 && !opts.allowedEmails.includes(email)) {
    throw new AppError("AUTHORIZATION_ERROR", "Email not in allow-list");
  }
  return { email };
}

// ── JWKS fetch with a small per-isolate cache ────────────────────────────────
interface CacheEntry {
  jwks: Jwks;
  fetchedAtMs: number;
}
const jwksCache = new Map<string, CacheEntry>();
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h

export function certsUrl(teamDomain: string): string {
  const host = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/cdn-cgi/access/certs`;
}

export async function fetchJwks(
  teamDomain: string,
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Jwks> {
  const url = certsUrl(teamDomain);
  const cached = jwksCache.get(url);
  if (cached && nowMs - cached.fetchedAtMs < JWKS_TTL_MS) return cached.jwks;
  const res = await fetchImpl(url);
  if (!res.ok) throw new AppError("CONFIGURATION_ERROR", "Failed to fetch Access certs");
  const jwks = (await res.json()) as Jwks;
  jwksCache.set(url, { jwks, fetchedAtMs: nowMs });
  return jwks;
}

/** Cloudflare Access issuer for a team domain. */
export function accessIssuer(teamDomain: string): string {
  const host = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}`;
}
