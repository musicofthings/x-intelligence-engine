/** Canonical X post URL building (spec §52) + outbound URL safety (spec §25). */

import { isSnowflake } from "./ids.js";

/**
 * Build the canonical link to an original X post. Returns null (never a malformed
 * URL) when inputs are unusable — callers should omit the link in that case.
 */
export function buildPostUrl(username: string | null | undefined, xPostId: string): string | null {
  if (!isSnowflake(xPostId)) return null;
  if (username && /^[A-Za-z0-9_]{1,15}$/.test(username)) {
    return `https://x.com/${username}/status/${xPostId}`;
  }
  // Fallback: the /i/web/status form works without a resolved username.
  return `https://x.com/i/web/status/${xPostId}`;
}

/**
 * Validate an outbound URL before any fetch (SSRF avoidance, spec §25).
 * v1 never fetches post links during screening; this guards future use.
 */
export function isSafeOutboundUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  // Block localhost / link-local / private ranges / metadata endpoints.
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host === "169.254.169.254" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }
  return true;
}
