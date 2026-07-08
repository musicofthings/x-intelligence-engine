import { describe, it, expect, beforeAll } from "vitest";
import { verifyAccessJwt, certsUrl, accessIssuer, type Jwks } from "../src/access.js";

/**
 * Real RS256 verification test: generate an RSA key with Web Crypto, sign an Access-
 * shaped JWT, export the public JWK, and verify. Covers signature + claim checks.
 */

const encoder = new TextEncoder();
const AUD = "test-aud-tag";
const ISSUER = "https://team.cloudflareaccess.com";
const EMAIL = "skannan@oncophenomics.com";
const NOW = 1_800_000_000; // fixed epoch seconds

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return b64url(encoder.encode(s));
}

let jwks: Jwks;
let signKey: CryptoKey;
const KID = "test-kid-1";

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  signKey = pair.privateKey;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  jwks = { keys: [{ kty: pub.kty!, kid: KID, n: pub.n!, e: pub.e!, alg: "RS256" }] };
});

async function makeJwt(payload: Record<string, unknown>, kid = KID): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64urlStr(JSON.stringify(payload));
  const data = encoder.encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signKey, data);
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

const opts = (over: Partial<Parameters<typeof verifyAccessJwt>[1]> = {}) => ({
  jwks,
  aud: AUD,
  issuer: ISSUER,
  allowedEmails: [EMAIL],
  nowSec: NOW,
  ...over,
});

describe("access jwt verification", () => {
  it("accepts a valid, correctly-signed token", async () => {
    const jwt = await makeJwt({ aud: [AUD], email: EMAIL, exp: NOW + 600, iss: ISSUER });
    const res = await verifyAccessJwt(jwt, opts());
    expect(res.email).toBe(EMAIL);
  });

  it("rejects a tampered payload (bad signature)", async () => {
    const jwt = await makeJwt({ aud: [AUD], email: EMAIL, exp: NOW + 600, iss: ISSUER });
    const [h, , s] = jwt.split(".");
    const forged = `${h}.${b64urlStr(JSON.stringify({ aud: [AUD], email: "attacker@evil.com", exp: NOW + 600, iss: ISSUER }))}.${s}`;
    await expect(verifyAccessJwt(forged, opts())).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  it("rejects an expired token", async () => {
    const jwt = await makeJwt({ aud: [AUD], email: EMAIL, exp: NOW - 1, iss: ISSUER });
    await expect(verifyAccessJwt(jwt, opts())).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  it("rejects an audience mismatch", async () => {
    const jwt = await makeJwt({ aud: ["other-aud"], email: EMAIL, exp: NOW + 600, iss: ISSUER });
    await expect(verifyAccessJwt(jwt, opts())).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("rejects an email not on the allow-list", async () => {
    const jwt = await makeJwt({ aud: [AUD], email: "stranger@example.com", exp: NOW + 600, iss: ISSUER });
    await expect(verifyAccessJwt(jwt, opts())).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("rejects an unknown signing key (kid)", async () => {
    const jwt = await makeJwt({ aud: [AUD], email: EMAIL, exp: NOW + 600, iss: ISSUER }, "unknown-kid");
    await expect(verifyAccessJwt(jwt, opts())).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  it("rejects an issuer mismatch", async () => {
    const jwt = await makeJwt({ aud: [AUD], email: EMAIL, exp: NOW + 600, iss: "https://evil.example.com" });
    await expect(verifyAccessJwt(jwt, opts())).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  it("builds the certs url and issuer from a team domain", () => {
    expect(certsUrl("team.cloudflareaccess.com")).toBe("https://team.cloudflareaccess.com/cdn-cgi/access/certs");
    expect(certsUrl("https://team.cloudflareaccess.com/")).toBe("https://team.cloudflareaccess.com/cdn-cgi/access/certs");
    expect(accessIssuer("team.cloudflareaccess.com")).toBe("https://team.cloudflareaccess.com");
  });
});
