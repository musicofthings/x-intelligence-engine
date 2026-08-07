import { describe, it, expect } from "vitest";
import { RedditClient, cleanSubreddit, parseRedditRateLimit } from "./client.js";
import { normalizeRedditListing, normalizeRedditPost, buildRedditQuery } from "./normalize.js";
import type { RedditListing } from "./types.js";

const CFG = { clientId: "id", clientSecret: "secret", userAgent: "xie-test/1.0" };
const NOW = Date.parse("2026-08-07T12:00:00Z");

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function listingResponse(body: RedditListing, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Records every request so tests can assert on auth headers and query strings. */
function stubFetch(handlers: ((url: string, init?: RequestInit) => Response | null)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return r;
    }
    return new Response("unmatched", { status: 500 });
  };
  return { impl, calls };
}

const tokenHandler = (url: string) => (url.includes("access_token") ? tokenResponse() : null);

describe("cleanSubreddit", () => {
  it("strips r/ prefixes and illegal characters", () => {
    expect(cleanSubreddit("r/bioinformatics")).toBe("bioinformatics");
    expect(cleanSubreddit("/r/MachineLearning")).toBe("MachineLearning");
    expect(cleanSubreddit("  data_science  ")).toBe("data_science");
    expect(cleanSubreddit("bad name!")).toBe("badname");
  });
});

describe("buildRedditQuery", () => {
  it("returns a bare term for a single keyword", () => {
    expect(buildRedditQuery(["ctDNA"])).toBe("ctDNA");
  });

  it("ORs multiple keywords and quotes phrases", () => {
    expect(buildRedditQuery(["ctDNA", "liquid biopsy"])).toBe('(ctDNA OR "liquid biopsy")');
  });

  it("drops blanks and caps at 10 terms", () => {
    expect(buildRedditQuery(["a", "", "  "])).toBe("a");
    const many = buildRedditQuery(Array.from({ length: 15 }, (_, i) => `k${i}`));
    expect(many.split(" OR ")).toHaveLength(10);
  });

  it("returns an empty string for no keywords", () => {
    expect(buildRedditQuery([])).toBe("");
  });
});

describe("normalizeRedditPost", () => {
  const base = {
    name: "t3_abc", id: "abc", author: "alice", author_fullname: "t2_x1",
    title: "New long-read assembly benchmark", selftext: "Details in the paper.",
    subreddit: "bioinformatics", created_utc: 1_775_000_000, permalink: "/r/bioinformatics/comments/abc/x/",
    score: 42, num_comments: 7,
  };

  it("maps a link post onto the canonical shape", () => {
    const p = normalizeRedditPost(base)!;
    expect(p.network).toBe("reddit");
    expect(p.xPostId).toBe("t3_abc");
    expect(p.authorUsername).toBe("alice");
    expect(p.text).toBe("New long-read assembly benchmark\n\nDetails in the paper.");
    expect(p.url).toBe("https://www.reddit.com/r/bioinformatics/comments/abc/x/");
    expect(p.metrics.likeCount).toBe(42);
    expect(p.metrics.replyCount).toBe(7);
    expect(p.createdAt).toBe(new Date(1_775_000_000 * 1000).toISOString());
  });

  it("derives the fullname from a bare id", () => {
    expect(normalizeRedditPost({ ...base, name: undefined })?.xPostId).toBe("t3_abc");
  });

  it("drops posts with no usable id or no text", () => {
    expect(normalizeRedditPost({ ...base, name: undefined, id: undefined })).toBeNull();
    expect(normalizeRedditPost({ ...base, title: "", selftext: "" })).toBeNull();
  });

  it("keeps the title but drops a removed body", () => {
    const p = normalizeRedditPost({ ...base, selftext: "[removed]" })!;
    expect(p.text).toBe("New long-read assembly benchmark");
  });

  it("treats a deleted author as unknown", () => {
    expect(normalizeRedditPost({ ...base, author: "[deleted]" })?.authorUsername).toBeNull();
  });

  it("tolerates a missing timestamp and negative scores", () => {
    const p = normalizeRedditPost({ ...base, created_utc: undefined, score: -5 })!;
    expect(p.createdAt).toBe("");
    expect(p.metrics.likeCount).toBe(0);
  });
});

describe("normalizeRedditListing", () => {
  const listing: RedditListing = {
    data: {
      after: "t3_next",
      children: [
        { kind: "t3", data: { name: "t3_1", title: "keep me", created_utc: 1, permalink: "/a" } },
        { kind: "t3", data: { name: "t3_2", title: "nsfw", over_18: true, created_utc: 1 } },
        { kind: "t3", data: { name: "t3_3", title: "pinned", stickied: true, created_utc: 1 } },
        { kind: "t3", data: { name: "t3_4", title: "gone", removed_by_category: "moderator", created_utc: 1 } },
        { kind: "t1", data: { name: "t1_5", title: "a comment", created_utc: 1 } },
      ],
    },
  };

  it("keeps only usable link posts and returns the cursor", () => {
    const { posts, after } = normalizeRedditListing(listing);
    expect(posts.map((p) => p.xPostId)).toEqual(["t3_1"]);
    expect(after).toBe("t3_next");
  });

  it("can opt back into nsfw and stickied posts", () => {
    const { posts } = normalizeRedditListing(listing, { excludeNsfw: false, excludeStickied: false });
    expect(posts.map((p) => p.xPostId)).toEqual(["t3_1", "t3_2", "t3_3"]);
  });

  it("returns an empty result for an empty listing", () => {
    expect(normalizeRedditListing({})).toEqual({ posts: [], after: null });
  });
});

describe("RedditClient", () => {
  it("refuses to construct without credentials or a user agent", () => {
    expect(() => new RedditClient({ ...CFG, clientId: "" })).toThrow(/not configured/);
    expect(() => new RedditClient({ ...CFG, userAgent: "" })).toThrow(/USER_AGENT/);
  });

  it("fetches an app-only token with basic auth, then calls the API as bearer", async () => {
    const { impl, calls } = stubFetch([tokenHandler, () => listingResponse({ data: { children: [] } })]);
    const c = new RedditClient(CFG, impl);
    await c.search({ query: "ctDNA" }, NOW);

    expect(calls[0]?.url).toContain("access_token");
    const tokenHeaders = calls[0]?.init?.headers as Record<string, string>;
    expect(tokenHeaders.authorization).toBe(`Basic ${btoa("id:secret")}`);
    expect(tokenHeaders["user-agent"]).toBe("xie-test/1.0");
    expect(calls[0]?.init?.body).toBe("grant_type=client_credentials");

    const apiHeaders = calls[1]?.init?.headers as Record<string, string>;
    expect(apiHeaders.authorization).toBe("Bearer tok");
    expect(apiHeaders["user-agent"]).toBe("xie-test/1.0");
  });

  it("reuses a cached token across calls", async () => {
    const { impl, calls } = stubFetch([tokenHandler, () => listingResponse({ data: { children: [] } })]);
    const c = new RedditClient(CFG, impl);
    await c.search({ query: "a" }, NOW);
    await c.search({ query: "b" }, NOW + 1000);
    expect(calls.filter((x) => x.url.includes("access_token"))).toHaveLength(1);
  });

  it("re-authenticates once the cached token is near expiry", async () => {
    const { impl, calls } = stubFetch([tokenHandler, () => listingResponse({ data: { children: [] } })]);
    const c = new RedditClient(CFG, impl);
    await c.search({ query: "a" }, NOW);
    await c.search({ query: "b" }, NOW + 3600_000);
    expect(calls.filter((x) => x.url.includes("access_token"))).toHaveLength(2);
  });

  it("searches site-wide without restrict_sr", async () => {
    const { impl, calls } = stubFetch([tokenHandler, () => listingResponse({ data: { children: [] } })]);
    await new RedditClient(CFG, impl).search({ query: "ctDNA", limit: 10 }, NOW);
    const url = new URL(calls[1]!.url);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("ctDNA");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("restrict_sr")).toBeNull();
  });

  it("restricts a search to the given subreddits", async () => {
    const { impl, calls } = stubFetch([tokenHandler, () => listingResponse({ data: { children: [] } })]);
    await new RedditClient(CFG, impl).search({ query: "mrd", subreddits: ["r/bioinformatics", "genomics"] }, NOW);
    const url = new URL(calls[1]!.url);
    expect(url.pathname).toBe("/r/bioinformatics+genomics/search");
    expect(url.searchParams.get("restrict_sr")).toBe("1");
  });

  it("clamps the limit into Reddit's accepted range", async () => {
    const { impl, calls } = stubFetch([tokenHandler, () => listingResponse({ data: { children: [] } })]);
    await new RedditClient(CFG, impl).search({ query: "x", limit: 500 }, NOW);
    expect(new URL(calls[1]!.url).searchParams.get("limit")).toBe("100");
  });

  it("requires at least one subreddit for subredditNew", () => {
    const { impl } = stubFetch([tokenHandler]);
    const c = new RedditClient(CFG, impl);
    // Rejected before any network call — a bad monitor config never costs a request.
    expect(() => c.subredditNew([], {}, NOW)).toThrow(/subreddit is required/);
    expect(() => c.subredditNew(["!!!"], {}, NOW)).toThrow(/subreddit is required/);
  });

  it("surfaces upstream failures as typed errors", async () => {
    const { impl } = stubFetch([tokenHandler, () => new Response("nope", { status: 429 })]);
    await expect(new RedditClient(CFG, impl).search({ query: "x" }, NOW)).rejects.toMatchObject({
      code: "RATE_LIMIT_ERROR",
    });
  });

  it("drops the cached token after a 401 so the next call re-authenticates", async () => {
    let apiCalls = 0;
    const { impl, calls } = stubFetch([
      tokenHandler,
      () => {
        apiCalls++;
        return apiCalls === 1 ? new Response("stale", { status: 401 }) : listingResponse({ data: { children: [] } });
      },
    ]);
    const c = new RedditClient(CFG, impl);
    await expect(c.search({ query: "x" }, NOW)).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
    await c.search({ query: "x" }, NOW);
    expect(calls.filter((x) => x.url.includes("access_token"))).toHaveLength(2);
  });

  it("parses rate-limit headers", () => {
    const h = new Headers({ "x-ratelimit-remaining": "297.0", "x-ratelimit-used": "3", "x-ratelimit-reset": "540" });
    expect(parseRedditRateLimit(h)).toEqual({ remaining: 297, used: 3, resetSeconds: 540 });
    expect(parseRedditRateLimit(new Headers())).toEqual({ remaining: null, used: null, resetSeconds: null });
  });
});
