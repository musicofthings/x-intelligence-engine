import { describe, it, expect } from "vitest";
import {
  importEncryptionKey,
  encryptSecret,
  decryptSecret,
  generateEncryptionKey,
  randomUrlSafe,
  sha256Base64Url,
  base64UrlEncode,
} from "./crypto.js";

describe("token encryption", () => {
  it("round-trips a secret", async () => {
    const key = await importEncryptionKey(generateEncryptionKey());
    const secret = "oauth-refresh-token-value";
    expect(await decryptSecret(key, await encryptSecret(key, secret))).toBe(secret);
  });

  it("round-trips empty and unicode payloads", async () => {
    const key = await importEncryptionKey(generateEncryptionKey());
    for (const s of ["", "🔐 токен — ตัวอย่าง"]) {
      expect(await decryptSecret(key, await encryptSecret(key, s))).toBe(s);
    }
  });

  it("produces different ciphertext for the same plaintext", async () => {
    const key = await importEncryptionKey(generateEncryptionKey());
    expect(await encryptSecret(key, "same")).not.toBe(await encryptSecret(key, "same"));
  });

  it("fails to decrypt under a different key", async () => {
    const a = await importEncryptionKey(generateEncryptionKey());
    const b = await importEncryptionKey(generateEncryptionKey());
    const env = await encryptSecret(a, "secret");
    await expect(decryptSecret(b, env)).rejects.toThrow(/could not be decrypted/);
  });

  it("rejects tampered ciphertext", async () => {
    const key = await importEncryptionKey(generateEncryptionKey());
    const env = await encryptSecret(key, "secret");
    const tampered = env.slice(0, -4) + (env.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    await expect(decryptSecret(key, tampered)).rejects.toThrow();
  });

  it("rejects a truncated envelope", async () => {
    const key = await importEncryptionKey(generateEncryptionKey());
    await expect(decryptSecret(key, base64UrlEncode(new Uint8Array(4)))).rejects.toThrow(/truncated/);
  });

  it("rejects a missing or wrong-sized key", async () => {
    await expect(importEncryptionKey("")).rejects.toThrow(/not set/);
    await expect(importEncryptionKey(btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});

describe("PKCE helpers", () => {
  it("emits url-safe values with no padding", () => {
    const v = randomUrlSafe(48);
    expect(v).not.toMatch(/[+/=]/);
    expect(v.length).toBeGreaterThan(60);
  });

  it("hashes deterministically to a url-safe digest", async () => {
    const a = await sha256Base64Url("verifier");
    expect(a).toBe(await sha256Base64Url("verifier"));
    expect(a).not.toBe(await sha256Base64Url("verifier2"));
    expect(a).not.toMatch(/[+/=]/);
  });
});
