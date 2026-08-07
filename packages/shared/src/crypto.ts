import { AppError } from "./errors.js";

/**
 * AES-256-GCM envelope for secrets at rest (OAuth access/refresh tokens in D1).
 * Web Crypto only — works identically in Workers and Node 20+.
 *
 * Format: base64( 12-byte IV || ciphertext||tag ). A fresh random IV per encryption,
 * so the same plaintext never produces the same ciphertext.
 */

const IV_BYTES = 12;

/**
 * The imported key handle. Derived from the Web Crypto API itself rather than naming
 * the `CryptoKey` global, which is absent under this package's `lib` (ES2022 + node).
 */
export type SecretKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Import a base64-encoded 32-byte key. Throws if the key is missing or wrong-sized. */
export async function importEncryptionKey(base64Key: string): Promise<SecretKey> {
  if (!base64Key) {
    throw new AppError("CONFIGURATION_ERROR", "TOKEN_ENCRYPTION_KEY is not set");
  }
  let raw: Uint8Array;
  try {
    raw = b64decode(base64Key);
  } catch {
    throw new AppError("CONFIGURATION_ERROR", "TOKEN_ENCRYPTION_KEY is not valid base64");
  }
  if (raw.length !== 32) {
    throw new AppError("CONFIGURATION_ERROR", "TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(key: SecretKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.length);
  return b64encode(packed);
}

export async function decryptSecret(key: SecretKey, envelope: string): Promise<string> {
  let packed: Uint8Array;
  try {
    packed = b64decode(envelope);
  } catch {
    throw new AppError("INTERNAL_ERROR", "Stored secret is not valid base64");
  }
  if (packed.length <= IV_BYTES) {
    throw new AppError("INTERNAL_ERROR", "Stored secret is truncated");
  }
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    // Wrong key or tampered ciphertext — never leak which.
    throw new AppError("INTERNAL_ERROR", "Stored secret could not be decrypted");
  }
}

/** Generate a fresh base64 key. Used by the setup script, never at request time. */
export function generateEncryptionKey(): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(32)));
}

/** URL-safe base64 without padding — required by RFC 7636 (PKCE). */
export function base64UrlEncode(bytes: Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlSafe(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** S256 code challenge for a PKCE verifier. */
export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}
