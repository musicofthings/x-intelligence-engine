import { describe, it, expect } from "vitest";
import { normalizeSearchResponse, normalizeTweet, indexUsers, isRepostDuplicate } from "./normalize.js";
import { parseRateLimit, backoffMs, shouldRetry, retryAfterFromReset } from "./ratelimit.js";
import { verifyWebhookSignature, crcResponse, constantTimeEqual, sha256Hex } from "./webhook.js";
import { XClient } from "./client.js";
import type { XSearchResponse } from "./types.js";

const searchResponse: XSearchResponse = {
  data: [
    {
      id: "1800000000000000123",
      text: "Nanopore long-read sequencing milestone https://doi.org/10.x",
      author_id: "55",
      created_at: "2026-07-01T12:00:00Z",
      conversation_id: "1800000000000000123",
      lang: "en",
      public_metrics: { like_count: 10, retweet_count: 2, reply_count: 1, quote_count: 0, bookmark_count: 3 },
    },
  ],
  includes: {
    users: [{ id: "55", name: "Genomics Co", username: "genomicsco", verified: true }],
  },
  meta: { newest_id: "1800000000000000123", result_count: 1 },
};

describe("normalization", () => {
  it("normalizes a tweet with author expansion", () => {
    const posts = normalizeSearchResponse(searchResponse);
    expect(posts).toHaveLength(1);
    const p = posts[0]!;
    expect(p.xPostId).toBe("1800000000000000123");
    expect(p.authorUsername).toBe("genomicsco");
    expect(p.url).toBe("https://x.com/genomicsco/status/1800000000000000123");
    expect(p.metrics.likeCount).toBe(10);
    expect(p.metrics.impressionCount).toBe(0); // missing optional defaults to 0
  });

  it("keeps ids as strings (no precision loss)", () => {
    const posts = normalizeSearchResponse(searchResponse);
    expect(typeof posts[0]!.xPostId).toBe("string");
    expect(posts[0]!.xPostId).toBe("1800000000000000123");
  });

  it("handles missing author expansion gracefully", () => {
    const users = indexUsers(undefined);
    const p = normalizeTweet({ id: "1800000000000000999", text: "hi", author_id: "999" }, users);
    expect(p.authorUsername).toBeNull();
    expect(p.url).toBe("https://x.com/i/web/status/1800000000000000999");
  });

  it("detects reposts", () => {
    expect(isRepostDuplicate({ id: "1", text: "RT @x: hi" })).toBe(true);
    expect(
      isRepostDuplicate({ id: "1", text: "orig", referenced_tweets: [{ type: "retweeted", id: "2" }] }),
    ).toBe(true);
    expect(isRepostDuplicate({ id: "1", text: "orig" })).toBe(false);
  });
});

describe("rate limiting", () => {
  it("parses headers", () => {
    const h = new Headers({ "x-rate-limit-limit": "450", "x-rate-limit-remaining": "12", "x-rate-limit-reset": "1000" });
    expect(parseRateLimit(h)).toEqual({ limit: 450, remaining: 12, resetAt: 1000 });
  });

  it("computes bounded jittered backoff", () => {
    expect(backoffMs(0, { rand: () => 0 })).toBe(0);
    expect(backoffMs(3, { baseMs: 1000, rand: () => 1 })).toBe(8000);
    expect(backoffMs(20, { baseMs: 1000, maxMs: 60000, rand: () => 1 })).toBe(60000);
  });

  it("decides retry only on 429/5xx within limit", () => {
    expect(shouldRetry(429, 0, 3)).toBe(true);
    expect(shouldRetry(503, 1, 3)).toBe(true);
    expect(shouldRetry(400, 0, 3)).toBe(false);
    expect(shouldRetry(429, 3, 3)).toBe(false);
  });

  it("computes retry-after from reset", () => {
    expect(retryAfterFromReset(1000, 990)).toBe(10000);
    expect(retryAfterFromReset(1000, 1000)).toBe(0);
    expect(retryAfterFromReset(null, 0)).toBeNull();
  });
});

describe("webhook verification", () => {
  const secret = "topsecret";

  it("verifies a valid signature and rejects a bad one", async () => {
    const body = JSON.stringify({ hello: "world" });
    const good = `sha256=${(await crcResponse(secret, body)).slice("sha256=".length)}`;
    expect(await verifyWebhookSignature(secret, body, good)).toBe(true);
    expect(await verifyWebhookSignature(secret, body, "sha256=deadbeef")).toBe(false);
    expect(await verifyWebhookSignature(secret, body, null)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, "nope")).toBe(false);
  });

  it("produces a crc response token", async () => {
    const token = await crcResponse(secret, "challenge");
    expect(token.startsWith("sha256=")).toBe(true);
  });

  it("constant-time compare works", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  it("hashes deterministically", async () => {
    expect(await sha256Hex("x")).toBe(await sha256Hex("x"));
  });
});

describe("client guards", () => {
  it("refuses to construct without a token", () => {
    expect(() => new XClient({ bearerToken: "" })).toThrow(/not configured/);
  });

  it("maps 401 to AUTHENTICATION_ERROR", async () => {
    const fakeFetch = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const c = new XClient({ bearerToken: "t" }, fakeFetch);
    await expect(c.recentSearch({ query: "x" })).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  it("sends bearer + lean fields on recent search", async () => {
    let captured: string | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = url;
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
      return new Response(JSON.stringify(searchResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const c = new XClient({ bearerToken: "t" }, fakeFetch);
    const r = await c.recentSearch({ query: "genomics", maxResults: 25 });
    expect(r.data.data).toHaveLength(1);
    expect(captured).toContain("/2/tweets/search/recent");
    expect(captured).toContain("tweet.fields");
  });
});
