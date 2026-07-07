import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Repositories, queryFeed, type D1Like } from "@xie/db";
import { createTestDb } from "../../../packages/db/test/adapter.js";
import { createLogger } from "@xie/shared";
import { loadEnv } from "@xie/config";
import { handleIngest, handleScreening, processPosts, type Ctx } from "../src/pipeline.js";
import type { IngestMessage, ScreeningMessage } from "../src/bindings.js";

/**
 * Automated acceptance flow (spec §66): create+enable monitor -> collect (mocked X)
 * -> normalize/upsert/dedupe/match/prefilter -> enqueue -> Claude (mocked) -> screening
 * -> alert -> feed. No live X scraping; all vendor calls mocked.
 */

const NOW = Date.parse("2026-07-07T12:00:00Z");

const X_RESPONSE = {
  data: [
    {
      id: "1800000000000000777",
      text: "FDA grants accelerated approval for a practice-changing oncology therapy. https://fda.gov/x",
      author_id: "900",
      created_at: "2026-07-07T09:00:00Z",
      conversation_id: "1800000000000000777",
      lang: "en",
      public_metrics: { like_count: 500, retweet_count: 100, reply_count: 40, quote_count: 10, bookmark_count: 80 },
    },
  ],
  includes: { users: [{ id: "900", name: "Regulatory Desk", username: "regdesk", verified: true }] },
  meta: { result_count: 1, newest_id: "1800000000000000777" },
};

const CLAUDE_RESPONSE = {
  content: [
    {
      type: "tool_use",
      name: "record_screening",
      input: {
        relevance_score: 92, novelty_score: 85, credibility_score: 80, strategic_importance_score: 96,
        topic: "Regulatory", subtopic: "FDA accelerated approval", requires_followup: true,
        reason: "Primary regulatory source (fda.gov) with concrete approval.",
        summary: "FDA grants accelerated approval for an oncology therapy.",
        recommended_action: "Retrieve the FDA announcement and brief the oncology team.",
        entities: [{ name: "FDA", type: "regulator" }],
        risks: [], evidence: ["fda.gov link"],
      },
    },
  ],
  usage: { input_tokens: 220, output_tokens: 90 },
};

function fakeQueue(sink: unknown[]): Queue {
  return { send: async (m: unknown) => { sink.push(m); } } as unknown as Queue;
}

function buildTestCtx(): { ctx: Ctx; ingestSink: unknown[]; screenSink: unknown[]; db: D1Like } {
  const { d1 } = createTestDb();
  const ingestSink: unknown[] = [];
  const screenSink: unknown[] = [];
  const bindings = {
    DB: d1,
    INGEST_QUEUE: fakeQueue(ingestSink),
    SCREENING_QUEUE: fakeQueue(screenSink),
    APP_ENV: "development", APP_VERSION: "test", APP_TIMEZONE: "Asia/Kolkata",
    X_BEARER_TOKEN: "x-token", X_API_BASE_URL: "https://api.x.com",
    ANTHROPIC_API_KEY: "a-key", ANTHROPIC_MODEL: "claude-test",
    X_DAILY_RESOURCE_BUDGET: "5000", X_MONTHLY_RESOURCE_BUDGET: "100000",
    CLAUDE_DAILY_REQUEST_BUDGET: "500", HARD_STOP_ON_BUDGET_EXCEEDED: "true",
  } as unknown as import("../src/bindings.js").Bindings;

  const env = loadEnv(bindings as unknown as Record<string, unknown>);
  const ctx: Ctx = {
    env,
    repo: new Repositories(d1, { nowIso: () => "2026-07-07T12:00:00Z" }, { next: (p) => `${p}_${seq++}` }),
    db: d1,
    logger: createLogger({ service: "test", environment: "development", sink: () => {} }),
    bindings,
  };
  return { ctx, ingestSink, screenSink, db: d1 };
}

let seq = 0;
beforeEach(() => { seq = 0; });

afterEach(() => vi.unstubAllGlobals());

describe("acceptance flow", () => {
  it("collects (mocked X), prefilters, enqueues, screens (mocked Claude), alerts, and surfaces in feed", async () => {
    const { ctx, screenSink, db } = buildTestCtx();

    // 1-4. Create + enable an oncology/regulatory monitor.
    const monitorId = await ctx.repo.createMonitor({
      name: "Regulatory and FDA", slug: "regulatory-fda-accept", type: "recent_search",
      xQuery: "(FDA OR approval) lang:en -is:retweet", enabled: true, priority: 90,
      prefilterThreshold: 40, alertThreshold: 90,
    });
    await ctx.repo.setMonitorEnabled(monitorId, true);

    // 5-9. Collection: mock the X API and run the ingest consumer.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("api.x.com")) {
        return new Response(JSON.stringify(X_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const ingestMsg: IngestMessage = {
      schema_version: 1, event_id: "e1", source_type: "recent_search",
      monitor_id: monitorId, received_at: "2026-07-07T12:00:00Z", payload: { trigger: "manual" },
    };
    await handleIngest(ctx, ingestMsg, NOW);

    // Post upserted + prefiltered + screening enqueued.
    const stored = await ctx.repo.getPostByXId("1800000000000000777");
    expect(stored).not.toBeNull();
    expect(screenSink).toHaveLength(1);
    const usageX = await ctx.repo.xResourcesSince("2026-07-01T00:00:00Z");
    expect(usageX).toBe(1);

    // 11-14. Screening: mock Claude and run the screening consumer.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("anthropic.com")) {
        return new Response(JSON.stringify(CLAUDE_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await handleScreening(ctx, screenSink[0] as ScreeningMessage, NOW);

    const screening = await ctx.repo.latestScreening(stored!.id);
    expect(screening?.strategicImportanceScore).toBe(96);
    expect(screening?.topic).toBe("Regulatory");

    // 14. Alert created (strategic 96 >= threshold 90).
    const alerts = await ctx.repo.listAlerts("open");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("critical");

    // 16. Post appears in the intelligence feed.
    const feed = await queryFeed(db, { minStrategic: 90 });
    expect(feed.data).toHaveLength(1);
    expect(feed.data[0]!.screening?.topic).toBe("Regulatory");

    // Claude usage recorded.
    expect(await ctx.repo.claudeRequestsSince("2026-07-01T00:00:00Z")).toBe(1);
  });

  it("screening is idempotent under duplicate queue delivery", async () => {
    const { ctx, screenSink } = buildTestCtx();
    const monitorId = await ctx.repo.createMonitor({ name: "M", slug: "m", type: "recent_search", enabled: true, prefilterThreshold: 40 });
    const { id } = await ctx.repo.upsertPost({
      xPostId: "1800000000000000888", authorId: "1", authorUsername: "a", authorName: "A",
      text: "practice-changing FDA approval https://fda.gov/x", lang: "en", createdAt: "2026-07-07T09:00:00Z",
      conversationId: null, inReplyToUserId: null, url: null,
      metrics: { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0, bookmarkCount: 0, impressionCount: 0 }, raw: {},
    });
    const msg: ScreeningMessage = { schema_version: 1, job_key: "k", post_id: id, monitor_id: monitorId, prompt_version: "x-intel-screen-v1" };

    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; return new Response(JSON.stringify(CLAUDE_RESPONSE), { status: 200 }); }));
    await handleScreening(ctx, msg, NOW);
    await handleScreening(ctx, msg, NOW); // duplicate delivery
    expect(calls).toBe(1); // second delivery short-circuits (already screened)
    void screenSink;
  });
});
