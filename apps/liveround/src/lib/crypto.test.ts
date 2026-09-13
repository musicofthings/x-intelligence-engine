import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, importEncryptionKey, randomUrlSafe, sha256Base64Url } from "./crypto";

const KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

describe("token encryption", () => {
  it("round-trips and never repeats ciphertext", async () => {
    const key = await importEncryptionKey(KEY);
    const a = await encryptSecret(key, "oauth-refresh-token-value");
    expect(await decryptSecret(key, a)).toBe("oauth-refresh-token-value");
    const b = await encryptSecret(key, "oauth-refresh-token-value");
    expect(a).not.toBe(b);
  });
});

describe("PKCE helpers", () => {
  it("builds a url-safe verifier and S256 challenge", async () => {
    const verifier = randomUrlSafe(48);
    expect(verifier).not.toMatch(/[+/=]/);
    const challenge = await sha256Base64Url(verifier);
    expect(challenge.length).toBeGreaterThan(20);
  });
});
