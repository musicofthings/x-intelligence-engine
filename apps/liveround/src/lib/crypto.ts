/**
 * AES-256-GCM envelope for OAuth tokens at rest.
 * Format: base64(12-byte IV || ciphertext||tag). Fresh IV per encrypt.
 */

const IV_BYTES = 12;

export type SecretKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlSafe(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function importEncryptionKey(base64Key: string): Promise<SecretKey> {
  if (!base64Key) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  let raw: Uint8Array;
  try {
    raw = b64decode(base64Key);
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEY is not valid base64");
  }
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(key: SecretKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBufferSource(iv) }, key, new TextEncoder().encode(plaintext));
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
    throw new Error("Stored secret is not valid base64");
  }
  if (packed.length <= IV_BYTES) throw new Error("Stored secret is truncated");
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      key,
      asBufferSource(ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("Stored secret could not be decrypted");
  }
}

export function generateEncryptionKey(): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(32)));
}

/** Dev-only: SHA-256 of AUTH_SECRET as a 32-byte key. Production requires TOKEN_ENCRYPTION_KEY. */
export async function resolveTokenKey(explicit?: string, authSecretValue?: string, nodeEnv?: string): Promise<SecretKey> {
  if (explicit) return importEncryptionKey(explicit);
  if (nodeEnv === "production") throw new Error("TOKEN_ENCRYPTION_KEY is required in production");
  if (!authSecretValue) throw new Error("Set TOKEN_ENCRYPTION_KEY to store OAuth tokens");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`liveround-dev:${authSecretValue}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
