import { describe, expect, it } from "vitest";
import { beginAuthorization } from "./oauth";

describe("X OAuth PKCE", () => {
  it("builds a consent URL with S256 challenge", async () => {
    const handshake = await beginAuthorization({
      clientId: "client",
      redirectUri: "http://localhost:3000/api/oauth/x/callback",
    });
    const url = new URL(handshake.url);
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("scope")).toContain("tweet.read");
    expect(url.searchParams.get("scope")).toContain("offline.access");
    expect(handshake.codeVerifier).toBeTruthy();
  });
});
