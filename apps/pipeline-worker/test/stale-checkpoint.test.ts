import { describe, it, expect, vi, afterEach } from "vitest";
import { Repositories, type D1Like } from "@xie/db";
import { createTestDb } from "../../../packages/db/test/adapter.js";
import { createLogger } from "@xie/shared";
import { loadEnv } from "@xie/config";
import { handleIngest, type Ctx } from "../src/pipeline.js";
import type { IngestMessage } from "../src/bindings.js";

/**
 * Regression: a `since_id` that has aged out of X's 7-day recent-search window.
 *
 * Observed in production on 2026-08-07 the moment collection was enabled. X answers
 * 400, which the collector treated as transient and rethrew -- so the queue retried
 * three times, dead-lettered, and the next cron enqueued the same doomed job again.
 * It could never succeed, because `setMonitorRunResult` uses COALESCE(?, since_id) and
 * therefore cannot clear the bad checkpoint.
 *
 * The fix must ACK the message and clear the checkpoint so the following run recovers
 * on its own, WITHOUT disabling the monitor (nothing is wrong with it).
 */

const NOW = Date.parse("2026-08-07T12:00:00Z");
let seq = 0;

const STALE_SINCE_ID_BODY = JSON.stringify({
  detail: "One or more parameters to your request was invalid.",
  errors: [{
    message: "'since_id' must be a tweet id created after 2026-07-31T11:45Z. Please use a 'since_id' that is larger than 2083157183716917248",
    parameters: { since_id: ["2075200933194039668"] },
  }],
  title: "Invalid Request",
});

function fakeQueue(sink: unknown[]): Queue {
  return { send: async (m: unknown) => { sink.push(m); } } as unknown as Queue;
}

function buildTestCtx(): { ctx: Ctx; db: D1Like } {
  const { d1 } = createTestDb();
  const bindings = {
    DB: d1,
    INGEST_QUEUE: fakeQueue([]),
    SCREENING_QUEUE: fakeQueue([]),
    APP_ENV: "development", APP_VERSION: "test", APP_TIMEZONE: "Asia/Kolkata",
    X_BEARER_TOKEN: "x-token", X_API_BASE_URL: "https://api.x.com",
    ANTHROPIC_API_KEY: "a-key", ANTHROPIC_MODEL: "claude-test",
    X_DAILY_RESOURCE_BUDGET: "5000", X_MONTHLY_RESOURCE_BUDGET: "100000",
    CLAUDE_DAILY_REQUEST_BUDGET: "500", HARD_STOP_ON_BUDGET_EXCEEDED: "true",
  } as unknown as import("../src/bindings.js").Bindings;

  return {
    ctx: {
      env: loadEnv(bindings as unknown as Record<string, unknown>),
      repo: new Repositories(d1, { nowIso: () => "2026-08-07T12:00:00Z" }, { next: (p) => `${p}_${seq++}` }),
      db: d1,
      logger: createLogger({ service: "test", environment: "development", sink: () => {} }),
      bindings,
    },
    db: d1,
  };
}

async function seedMonitor(ctx: Ctx, sinceId: string | null): Promise<string> {
  // Unique slug: migration 0003 already seeds monitors, and `monitors.slug` is UNIQUE.
  const id = await ctx.repo.createMonitor({
    name: "Oncology test", slug: `oncology-test-${seq++}`, type: "recent_search",
    xQuery: "(oncology OR cancer)", enabled: true,
  });
  if (sinceId) {
    await ctx.repo.setMonitorRunResult(id, { lastRunAt: "2026-07-30T00:00:00Z", sinceId });
  }
  return id;
}

function xErrorFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

const msg = (monitorId: string): IngestMessage => ({
  schema_version: 1, event_id: "e1", source_type: "recent_search",
  monitor_id: monitorId, received_at: "2026-08-07T12:00:00Z", payload: { trigger: "cron" },
});

afterEach(() => vi.unstubAllGlobals());

describe("stale since_id checkpoint", () => {
  it("acks instead of throwing, so the queue stops retrying a doomed job", async () => {
    const { ctx } = buildTestCtx();
    const id = await seedMonitor(ctx, "2075200933194039668");
    vi.stubGlobal("fetch", xErrorFetch(400, STALE_SINCE_ID_BODY));

    // The bug was that this rethrew. Retrying with the same since_id can never succeed.
    await expect(handleIngest(ctx, msg(id), NOW)).resolves.toBeUndefined();
  });

  it("clears the checkpoint so the next run recovers", async () => {
    const { ctx } = buildTestCtx();
    const id = await seedMonitor(ctx, "2075200933194039668");
    expect((await ctx.repo.getMonitor(id))!.sinceId).toBe("2075200933194039668");

    vi.stubGlobal("fetch", xErrorFetch(400, STALE_SINCE_ID_BODY));
    await handleIngest(ctx, msg(id), NOW);

    expect((await ctx.repo.getMonitor(id))!.sinceId).toBeNull();
  });

  it("leaves the monitor enabled — nothing is wrong with it", async () => {
    const { ctx } = buildTestCtx();
    const id = await seedMonitor(ctx, "2075200933194039668");
    vi.stubGlobal("fetch", xErrorFetch(400, STALE_SINCE_ID_BODY));
    await handleIngest(ctx, msg(id), NOW);

    expect((await ctx.repo.getMonitor(id))!.enabled).toBe(true);
  });

  it("records the failed run for the operator", async () => {
    const { ctx } = buildTestCtx();
    const id = await seedMonitor(ctx, "2075200933194039668");
    vi.stubGlobal("fetch", xErrorFetch(400, STALE_SINCE_ID_BODY));
    await handleIngest(ctx, msg(id), NOW);

    const runs = await ctx.repo.recentRuns(5);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toContain("400");
  });

  it("collects normally on the very next run once the checkpoint is gone", async () => {
    const { ctx } = buildTestCtx();
    const id = await seedMonitor(ctx, "2075200933194039668");

    vi.stubGlobal("fetch", xErrorFetch(400, STALE_SINCE_ID_BODY));
    await handleIngest(ctx, msg(id), NOW);

    // Second run: no since_id is sent, so X answers normally.
    let sentUrl = "";
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
      sentUrl = String(input);
      return new Response(JSON.stringify({
        data: [{
          id: "2083157183716917248", text: "Phase 3 readout in oncology.", author_id: "9",
          created_at: "2026-08-07T11:00:00Z", lang: "en",
          public_metrics: { like_count: 10, retweet_count: 1, reply_count: 0, quote_count: 0, bookmark_count: 0 },
        }],
        includes: { users: [{ id: "9", username: "trialdesk", name: "Trial Desk" }] },
        meta: { result_count: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);

    await handleIngest(ctx, msg(id), NOW + 3_600_000);

    expect(sentUrl).not.toContain("since_id");
    expect(await ctx.repo.getPostByXId("2083157183716917248")).not.toBeNull();
    // And the fresh checkpoint is stored for next time.
    expect((await ctx.repo.getMonitor(id))!.sinceId).toBe("2083157183716917248");
  });

  it("still pauses the monitor on an unrelated 400, which will not fix itself", async () => {
    const { ctx } = buildTestCtx();
    const id = await seedMonitor(ctx, null);
    vi.stubGlobal("fetch", xErrorFetch(400, '{"errors":[{"message":"Invalid query syntax"}]}'));

    await expect(handleIngest(ctx, msg(id), NOW)).resolves.toBeUndefined();
    expect((await ctx.repo.getMonitor(id))!.enabled).toBe(false);
  });

  it("still retries a 429 rather than wiping a good checkpoint", async () => {
    const { ctx } = buildTestCtx();
    const id = await seedMonitor(ctx, "2075200933194039668");
    vi.stubGlobal("fetch", xErrorFetch(429, "rate limited"));

    await expect(handleIngest(ctx, msg(id), NOW)).rejects.toThrow();
    expect((await ctx.repo.getMonitor(id))!.sinceId).toBe("2075200933194039668");
    expect((await ctx.repo.getMonitor(id))!.enabled).toBe(true);
  });
});
