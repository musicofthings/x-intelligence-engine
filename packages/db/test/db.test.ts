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

describe("watchlists", () => {
  it("creates, lists with counts, adds/removes accounts, and deletes", async () => {
    const { repo } = repos();
    const id = await repo.createWatchlist({ name: "Oncology KOLs", slug: "oncology-kols" });
    let lists = await repo.listWatchlists();
    expect(lists).toHaveLength(1);
    expect(lists[0]!.accountCount).toBe(0);

    const accId = await repo.addWatchlistAccount(id, { username: "@fda", priority: 90 });
    await repo.addWatchlistAccount(id, { username: "genomicsco" });
    const accts = await repo.listWatchlistAccounts(id);
    expect(accts).toHaveLength(2);
    expect(accts[0]!.username).toBe("fda"); // @ stripped, highest priority first

    lists = await repo.listWatchlists();
    expect(lists[0]!.accountCount).toBe(2);

    // adding the same handle upserts (no duplicate)
    await repo.addWatchlistAccount(id, { username: "fda", priority: 80 });
    expect(await repo.listWatchlistAccounts(id)).toHaveLength(2);

    await repo.removeWatchlistAccount(id, accId);
    expect(await repo.listWatchlistAccounts(id)).toHaveLength(1);

    await repo.deleteWatchlist(id);
    expect(await repo.listWatchlists()).toHaveLength(0);
  });

  it("toggles enabled state", async () => {
    const { repo } = repos();
    const id = await repo.createWatchlist({ name: "AI Labs", slug: "ai-labs" });
    await repo.setWatchlistEnabled(id, false);
    expect((await repo.getWatchlist(id))!.enabled).toBe(false);
  });

  it("schedules due accounts, respects interval + enabled, resolves + checkpoints", async () => {
    const { repo } = repos();
    const wl = await repo.createWatchlist({ name: "Genomics", slug: "genomics-cos" });
    const accId = await repo.addWatchlistAccount(wl, { username: "nanopore", priority: 80 });
    const now = Date.parse("2026-07-07T12:00:00Z");

    let due = await repo.dueWatchlistAccounts(now, 180);
    expect(due).toHaveLength(1);
    expect(due[0]!.xUserId).toBeNull();

    await repo.resolveWatchlistAccountId(accId, "55555");
    await repo.checkpointWatchlistAccount(accId, "1800000000000000099", "2026-07-07T12:00:00Z");

    // just polled -> not due within interval
    expect(await repo.dueWatchlistAccounts(now + 60 * 60_000, 180)).toHaveLength(0);
    // after interval -> due again, now with resolved id + since_id
    due = await repo.dueWatchlistAccounts(now + 200 * 60_000, 180);
    expect(due).toHaveLength(1);
    expect(due[0]!.xUserId).toBe("55555");
    expect(due[0]!.sinceId).toBe("1800000000000000099");

    // disabled watchlist -> excluded
    await repo.setWatchlistEnabled(wl, false);
    expect(await repo.dueWatchlistAccounts(now + 200 * 60_000, 180)).toHaveLength(0);
  });
});

describe("manual alerts", () => {
  it("creates a standalone alert with no post/monitor", async () => {
    const { repo } = repos();
    const id = await repo.createManualAlert({ severity: "high", title: "Watch item", reason: "Analyst flagged" });
    expect(id).toBeTruthy();
    const alerts = await repo.listAlerts("open");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.postId).toBe(""); // null post_id maps to empty string
    expect(alerts[0]!.severity).toBe("high");
  });
});

describe("maintenance", () => {
  it("reports stats and clears runs without touching monitors", async () => {
    const { repo } = repos();
    const { id } = await repo.upsertPost(post());
    await repo.startRun("mon_genomics", "rk1", "success");
    const before = await repo.maintenanceStats();
    expect(before.posts).toBe(1);
    expect(before.ingestion_runs).toBe(1);
    expect(before.monitors).toBe(8);

    const cleared = await repo.clearRuns();
    expect(cleared).toBe(1);
    const after = await repo.maintenanceStats();
    expect(after.ingestion_runs).toBe(0);
    expect(after.monitors).toBe(8); // config preserved
    void id;
  });

  it("resetIntelligence wipes data but preserves monitors + settings", async () => {
    const { repo } = repos();
    await repo.upsertPost(post());
    await repo.recordUsage({ provider: "x", operation: "recent_search", monitorId: "mon_genomics", resourceCount: 5 });
    await repo.resetIntelligence({ resetCheckpoints: true });
    const s = await repo.maintenanceStats();
    expect(s.posts).toBe(0);
    expect(s.api_usage).toBe(0);
    expect(s.monitors).toBe(8);
    expect(await repo.getSetting<string>("app.timezone")).toBe("Asia/Kolkata");
  });

  it("purgeOldPosts never deletes starred posts (spec §51)", async () => {
    const { repo } = repos();
    const oldA = await repo.upsertPost(post({ xPostId: "1800000000000000010", createdAt: "2020-01-01T00:00:00Z" }));
    const oldStarred = await repo.upsertPost(post({ xPostId: "1800000000000000011", createdAt: "2020-01-01T00:00:00Z" }));
    await repo.patchState(oldStarred.id, { isStarred: true });
    const deleted = await repo.purgeOldPosts("2021-01-01T00:00:00Z");
    expect(deleted).toBe(1); // only the non-starred old post
    expect(await repo.getPost(oldA.id)).toBeNull();
    expect(await repo.getPost(oldStarred.id)).not.toBeNull();
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
