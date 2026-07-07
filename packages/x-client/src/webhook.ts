import { toSnowflake } from "@xie/shared";

/**
 * X webhook helpers (spec §7.5).
 *
 * IMPORTANT: X's Filtered Stream / Account Activity webhook protocols evolve. The
 * HMAC-SHA256 CRC scheme below matches the widely-documented Account Activity API
 * pattern, but the exact header name and challenge format MUST be confirmed against
 * current official X documentation before enabling in production. All comparisons are
 * constant-time via Web Crypto (Workers-compatible).
 */

const encoder = new TextEncoder();

async function hmacSha256(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Constant-time string comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Respond to the CRC challenge (GET) — returns the base64 HMAC response token.
 * The route wraps this as `{ response_token: "sha256=<b64>" }` per current protocol.
 */
export async function crcResponse(secret: string, crcToken: string): Promise<string> {
  const sig = await hmacSha256(secret, crcToken);
  return `sha256=${toBase64(sig)}`;
}

/**
 * Verify an incoming webhook POST signature. `signatureHeader` is expected in the
 * form `sha256=<base64>`. Returns true only on a constant-time match.
 */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = `sha256=${toBase64(await hmacSha256(secret, rawBody))}`;
  return constantTimeEqual(expected, signatureHeader);
}

/** Deterministic dedup id for a webhook event (spec §10.16, idempotency). */
export function webhookEventId(payload: { id?: string; event_id?: string }, fallbackHash: string): string {
  const raw = payload.event_id ?? payload.id;
  if (raw && /^[0-9]+$/.test(raw)) return toSnowflake(raw);
  return fallbackHash;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
