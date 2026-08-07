import { describe, it, expect } from "vitest";
import { beginAuthorization, exchangeCode, refreshAccessToken, isExpired, DEFAULT_SCOPES } from "./oauth.js";
import { XWriteClient, X_MAX_REPLY_CHARS } from "./write.js";
import { isStaleSinceIdError } from "./ratelimit.js";

const CFG = {
  clientId: "cid",
  redirectUri: "https://xie.example.com/api/oauth/x/callback",
};
const NOW = Date.parse("2026-08-07T12:00:00Z");

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function recorder(response: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return response();
  };
  return { impl, calls };
}

describe("beginAuthorization", () => {
  it("builds a PKCE consent URL with the S256 challenge", async () => {
    const h = await beginAuthorization(CFG);
    const url = new URL(h.url);
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(CFG.redirectUri);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe(h.state);
  });

  it("requests offline.access so refresh tokens are issued", async () => {
    const scopes = new URL((await beginAuthorization(CFG)).url).searchParams.get("scope")!.split(" ");
    expect(scopes).toContain("tweet.write");
    expect(scopes).toContain("offline.access");
    expect(DEFAULT_SCOPES).toContain("offline.access");
  });

  it("never puts the verifier in the URL", async () => {
    const h = await beginAuthorization(CFG);
    expect(h.codeVerifier.length).toBeGreaterThan(40);
    expect(h.url).not.toContain(h.codeVerifier);
  });

  it("produces a distinct state and verifier every time", async () => {
    const a = await beginAuthorization(CFG);
    const b = await beginAuthorization(CFG);
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it("refuses to start without a client id or redirect uri", async () => {
    await expect(beginAuthorization({ ...CFG, clientId: "" })).rejects.toThrow(/CLIENT_ID/);
    await expect(beginAuthorization({ ...CFG, redirectUri: "" })).rejects.toThrow(/redirect URI/);
  });
});

describe("exchangeCode", () => {
  it("posts the verifier and returns an absolute expiry", async () => {
    const { impl, calls } = recorder(() =>
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 7200, scope: "tweet.write" }),
    );
    const t = await exchangeCode(CFG, { code: "abc", codeVerifier: "ver" }, impl, NOW);

    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("abc");
    expect(body.get("code_verifier")).toBe("ver");
    expect(body.get("redirect_uri")).toBe(CFG.redirectUri);

    expect(t.accessToken).toBe("at");
    expect(t.refreshToken).toBe("rt");
    expect(t.expiresAt).toBe(new Date(NOW + 7200_000).toISOString());
  });

  it("omits basic auth for a public client and sends it for a confidential one", async () => {
    const pub = recorder(() => jsonResponse({ access_token: "at" }));
    await exchangeCode(CFG, { code: "c", codeVerifier: "v" }, pub.impl, NOW);
    expect((pub.calls[0]?.init?.headers as Record<string, string>).authorization).toBeUndefined();

    const conf = recorder(() => jsonResponse({ access_token: "at" }));
    await exchangeCode({ ...CFG, clientSecret: "sec" }, { code: "c", codeVerifier: "v" }, conf.impl, NOW);
    expect((conf.calls[0]?.init?.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("cid:sec")}`);
  });

  it("maps a rejected code to an authentication error", async () => {
    const { impl } = recorder(() => jsonResponse({ error: "invalid_grant" }, 400));
    await expect(exchangeCode(CFG, { code: "bad", codeVerifier: "v" }, impl, NOW)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
  });

  it("rejects a 200 response with no access token", async () => {
    const { impl } = recorder(() => jsonResponse({ token_type: "bearer" }));
    await expect(exchangeCode(CFG, { code: "c", codeVerifier: "v" }, impl, NOW)).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
    });
  });
});

describe("refreshAccessToken", () => {
  it("sends the refresh grant", async () => {
    const { impl, calls } = recorder(() => jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 7200 }));
    const t = await refreshAccessToken(CFG, "rt1", impl, NOW);
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt1");
    expect(t.accessToken).toBe("at2");
  });

  it("fails clearly when there is no stored refresh token", async () => {
    const { impl } = recorder(() => jsonResponse({}));
    await expect(refreshAccessToken(CFG, "", impl, NOW)).rejects.toThrow(/reconnect the X account/);
  });
});

describe("isExpired", () => {
  it("treats a token inside the skew window as expired", () => {
    const soon = new Date(NOW + 60_000).toISOString();
    expect(isExpired(soon, NOW, 120)).toBe(true);
    expect(isExpired(new Date(NOW + 600_000).toISOString(), NOW, 120)).toBe(false);
  });

  it("treats a missing expiry as usable and a malformed one as expired", () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired("not-a-date", NOW)).toBe(true);
  });
});

describe("isStaleSinceIdError", () => {
  // Verbatim body X returned in production on 2026-08-07 once collection was enabled
  // with checkpoints older than the 7-day recent-search window.
  const REAL_BODY = JSON.stringify({
    detail: "One or more parameters to your request was invalid.",
    errors: [{
      message: "'since_id' must be a tweet id created after 2026-07-31T11:45Z. Please use a 'since_id' that is larger than 2083157183716917248",
      parameters: { since_id: ["2075200933194039668"] },
    }],
    title: "Invalid Request",
  });

  it("recognizes the aged-out checkpoint response", () => {
    expect(isStaleSinceIdError(400, REAL_BODY)).toBe(true);
  });

  it("ignores other 400s so a bad query still pauses the monitor", () => {
    expect(isStaleSinceIdError(400, '{"errors":[{"message":"Invalid query"}]}')).toBe(false);
    expect(isStaleSinceIdError(400, "")).toBe(false);
    expect(isStaleSinceIdError(400, undefined)).toBe(false);
  });

  it("ignores non-400 statuses", () => {
    // A 429 must stay retryable; misreading it as a checkpoint problem would silently
    // wipe a perfectly good since_id and re-collect everything.
    expect(isStaleSinceIdError(429, REAL_BODY)).toBe(false);
    expect(isStaleSinceIdError(500, REAL_BODY)).toBe(false);
    expect(isStaleSinceIdError(undefined, REAL_BODY)).toBe(false);
  });
});

describe("XWriteClient", () => {
  it("refuses to construct without a user-context token", () => {
    expect(() => new XWriteClient({ accessToken: "" })).toThrow(/connect one to send replies/);
  });

  it("posts a reply with in_reply_to_tweet_id and returns the new id", async () => {
    const { impl, calls } = recorder(() => jsonResponse({ data: { id: "999", text: "hi" } }));
    const r = await new XWriteClient({ accessToken: "user-token" }, impl).replyTo("123", "hi");

    expect(calls[0]?.url).toBe("https://api.x.com/2/tweets");
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe("Bearer user-token");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      text: "hi",
      reply: { in_reply_to_tweet_id: "123" },
    });
    expect(r.id).toBe("999");
  });

  it("validates locally before spending a request", async () => {
    let called = 0;
    const impl: typeof fetch = async () => {
      called++;
      return jsonResponse({ data: { id: "1" } });
    };
    const c = new XWriteClient({ accessToken: "t" }, impl);
    await expect(c.replyTo("123", "   ")).rejects.toThrow(/empty/);
    await expect(c.replyTo("123", "x".repeat(X_MAX_REPLY_CHARS + 1))).rejects.toThrow(/exceeds/);
    await expect(c.replyTo("not-numeric", "hi")).rejects.toThrow(/numeric X post id/);
    expect(called).toBe(0);
  });

  it("maps upstream failures onto the error taxonomy", async () => {
    for (const [status, code] of [[401, "AUTHENTICATION_ERROR"], [403, "AUTHORIZATION_ERROR"], [429, "RATE_LIMIT_ERROR"], [500, "X_API_ERROR"]] as const) {
      const { impl } = recorder(() => new Response("err", { status }));
      await expect(new XWriteClient({ accessToken: "t" }, impl).replyTo("1", "hi")).rejects.toMatchObject({ code });
    }
  });

  it("rejects a success response that carries no post id", async () => {
    const { impl } = recorder(() => jsonResponse({ data: {} }));
    await expect(new XWriteClient({ accessToken: "t" }, impl).replyTo("1", "hi")).rejects.toMatchObject({
      code: "X_API_ERROR",
    });
  });

  it("resolves the connected account via /2/users/me", async () => {
    const { impl } = recorder(() => jsonResponse({ data: { id: "7", username: "alice", name: "Alice" } }));
    expect(await new XWriteClient({ accessToken: "t" }, impl).me()).toEqual({
      id: "7", username: "alice", name: "Alice",
    });
  });
});
