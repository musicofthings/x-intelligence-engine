import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./adapter.js";
import { Repositories } from "../src/repositories.js";
import { queryFeed } from "../src/feed.js";
import type { Clock, IdGen } from "../src/d1.js";
import type { NormalizedXPost } from "@xie/shared";

let seq = 0;
const clock: Clock = { nowIso: () => "2026-07-07T00:00:00.000Z" };
const ids: IdGen = { next: (p) => `${p}_${(seq++).toString().padStart(4, "0")}` };

function repos() {
  const { d1, raw } = createTestDb();
  seq = 0;
  return { repo: new Repositories(d1, clock, ids), d1, raw };
}

function post(over: Partial<NormalizedXPost> = {}): NormalizedXPost {
  return {
    xPostId: "1800000000000000001",
    authorId: "42",
    authorUsername: "genomicsco",
    authorName: "Genomics Co",
    text: "Long-read sequencing breakthrough with primary source https://doi.org/10.1/x",
    lang: "en",
    createdAt: "2026-07-06T10:00:00Z",
    conversationId: "1800000000000000001",
    inReplyToUserId: null,
    url: "https://x.com/genomicsco/status/1800000000000000001",
    metrics: { likeCount: 100, repostCount: 10, replyCount: 5, quoteCount: 1, bookmarkCount: 20, impressionCount: 5000 },
    raw: { id: "1800000000000000001" },
    ...over,
  };
}

describe("migrations + seed", () => {
  it("applies all migrations and seeds 8 disabled monitors", async () => {
    const { repo } = repos();
    const monitors = await repo.listMonitors();
    expect(monitors).toHaveLength(8);
    expect(monitors.every((m) => !m.enabled)).toBe(true); // seeded disabled (spec §58)
  });

  it("has default settings", async () => {
    const { repo } = repos();
    expect(await repo.getSetting<string>("app.timezone")).toBe("Asia/Kolkata");
  });
});

describe("post upsert idempotency", () => {
  it("inserts once, updates metrics on re-observation, preserves first_seen", async () => {
    const { repo } = repos();
    const a = await repo.upsertPost(post());
    expect(a.isNew).toBe(true);
    const b = await repo.upsertPost(post({ metrics: { ...post().metrics, likeCount: 999 } }));
    expect(b.isNew).toBe(false);
    expect(b.id).toBe(a.id); // same row (unique x_post_id)
    const stored = await repo.getPost(a.id);
    expect(stored?.metrics.likeCount).toBe(999);
    expect(stored?.firstSeenAt).toBe("2026-07-07T00:00:00.000Z");
  });
});

describe("match + screening idempotency", () => {
  it("records a match once even on duplicate delivery", async () => {
    const { repo } = repos();
    const { id } = await repo.upsertPost(post());
    await repo.recordMatch(id, "mon_genomics", "seed");
    await repo.recordMatch(id, "mon_genomics", "seed");
    expect(await repo.monitorMatchCount(id)).toBe(1);
  });

  it("guards double screening by post+model+prompt", async () => {
    const { repo } = repos();
    const { id } = await repo.upsertPost(post());
    const result = {
      relevanceScore: 80, noveltyScore: 70, credibilityScore: 65, strategicImportanceScore: 92,
      topic: "Genomics", subtopic: "long-read", requiresFollowup: true, reason: "r", summary: "s",
      recommendedAction: "a", entities: [], risks: [], evidence: [],
    };
    expect(await repo.isAlreadyScreened(id, "claude-x", "v1")).toBe(false);
    await repo.saveScreening(id, "anthropic", "claude-x", "v1", result, { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01 }, {});
    expect(await repo.isAlreadyScreened(id, "claude-x", "v1")).toBe(true);
    // upsert on conflict, still one row
    await repo.saveScreening(id, "anthropic", "claude-x", "v1", { ...result, strategicImportanceScore: 50 }, { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01 }, {});
    const latest = await repo.latestScreening(id);
    expect(latest?.strategicImportanceScore).toBe(50);
  });
});

describe("alerts + runs idempotency", () => {
  it("dedupes alert per post+monitor", async () => {
    const { repo } = repos();
    const { id } = await repo.upsertPost(post());
    await repo.createAlert({ postId: id, monitorId: "mon_genomics", severity: "high", title: "t", reason: "r" });
    await repo.createAlert({ postId: id, monitorId: "mon_genomics", severity: "critical", title: "t2", reason: "r2" });
    expect(await repo.listAlerts()).toHaveLength(1);
  });

  it("start run is idempotent on run_key", async () => {
    const { repo } = repos();
    const a = await repo.startRun("mon_genomics", "run-key-1", "running");
    const b = await repo.startRun("mon_genomics", "run-key-1", "running");
    expect(a).toBe(b);
    expect(await repo.recentRuns()).toHaveLength(1);
  });
});

describe("webhook dedup", () => {
  it("returns true only for first delivery", async () => {
    const { repo } = repos();
    expect(await repo.recordWebhookEvent("x", "evt1", "hash1")).toBe(true);
    expect(await repo.recordWebhookEvent("x", "evt1", "hash1")).toBe(false);
  });
});

describe("usage accounting", () => {
  it("aggregates x resources and claude requests", async () => {
    const { repo } = repos();
    await repo.recordUsage({ provider: "x", operation: "recent_search", monitorId: "mon_genomics", resourceCount: 25 });
    await repo.recordUsage({ provider: "anthropic", operation: "screen", monitorId: null, requestCount: 1, inputTokens: 100, outputTokens: 50 });
    expect(await repo.xResourcesSince("2026-07-01T00:00:00Z")).toBe(25);
    expect(await repo.claudeRequestsSince("2026-07-01T00:00:00Z")).toBe(1);
  });
});

describe("feed query + cursor", () => {
  it("filters by strategic score and paginates by cursor", async () => {
    const { repo, d1 } = repos();
    for (let i = 1; i <= 3; i++) {
      const p = post({ xPostId: `18000000000000000${i}0`, createdAt: `2026-07-0${i}T10:00:00Z` });
      const { id } = await repo.upsertPost(p);
      await repo.saveScreening(id, "anthropic", "m", "v1", {
        relevanceScore: 80, noveltyScore: 60, credibilityScore: 60, strategicImportanceScore: 70 + i,
        topic: "Genomics", subtopic: "", requiresFollowup: false, reason: "r", summary: "s", recommendedAction: "a",
        entities: [], risks: [], evidence: [],
      }, { inputTokens: null, outputTokens: null, estimatedCostUsd: null }, {});
    }
    const firstPage = await queryFeed(d1, { minStrategic: 71, limit: 2 });
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.page.has_more).toBe(true);
    const nextPage = await queryFeed(d1, { minStrategic: 71, limit: 2, cursor: firstPage.page.next_cursor });
    expect(nextPage.data.length).toBeGreaterThanOrEqual(1);
  });
});
