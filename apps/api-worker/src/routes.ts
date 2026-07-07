import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "@xie/shared";
import { queryFeed } from "@xie/db";
import { pricingFromEnv, estimateXCost } from "@xie/config";
import type { HonoEnv } from "./bindings.js";

/** REST API routes (spec §19). All DB access via repositories; validation via Zod. */
export function apiRoutes(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  // ── Dashboard ──────────────────────────────────────────────────────────────
  app.get("/dashboard/summary", async (c) => {
    const repo = c.get("repo");
    const nowMs = Date.now();
    const todayIso = new Date(nowMs - (nowMs % 86_400_000)).toISOString();
    const monthIso = new Date(nowMs - 30 * 86_400_000).toISOString();
    const [monitors, runs, openAlerts, xToday, claudeToday, xMonth] = await Promise.all([
      repo.listMonitors(),
      repo.recentRuns(20),
      repo.listAlerts("open"),
      repo.xResourcesSince(todayIso),
      repo.claudeRequestsSince(todayIso),
      repo.xResourcesSince(monthIso),
    ]);
    const lastSuccess = runs.find((r) => r.status === "success")?.completedAt ?? null;
    return c.json({
      data: {
        active_monitors: monitors.filter((m) => m.enabled).length,
        total_monitors: monitors.length,
        open_alerts: openAlerts.length,
        x_resources_today: xToday,
        x_resources_month: xMonth,
        claude_requests_today: claudeToday,
        last_successful_collection: lastSuccess,
        failed_jobs: runs.filter((r) => r.status === "failed").length,
        recent_runs: runs.slice(0, 10),
      },
    });
  });

  app.get("/dashboard/trends", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT substr(scored_at,1,10) AS day, COUNT(*) AS n,
        SUM(CASE WHEN strategic_importance_score>=75 THEN 1 ELSE 0 END) AS high
       FROM screening_results WHERE scored_at >= ? GROUP BY day ORDER BY day`,
    ).bind(new Date(Date.now() - 7 * 86_400_000).toISOString()).all();
    return c.json({ data: results });
  });

  app.get("/dashboard/topics", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT topic, COUNT(*) AS n FROM screening_results WHERE topic IS NOT NULL AND topic != ''
       GROUP BY topic ORDER BY n DESC LIMIT 20`,
    ).all();
    return c.json({ data: results });
  });

  app.get("/dashboard/sources", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT author_username AS username, author_name AS name, COUNT(*) AS posts
       FROM posts WHERE author_username IS NOT NULL GROUP BY author_username ORDER BY posts DESC LIMIT 20`,
    ).all();
    return c.json({ data: results });
  });

  // ── Posts ────────────────────────────────────────────────────────────────
  const feedQuery = z.object({
    monitor: z.string().optional(),
    topic: z.string().optional(),
    author: z.string().optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    min_relevance: z.coerce.number().int().optional(),
    min_strategic: z.coerce.number().int().optional(),
    requires_followup: z.enum(["true", "false"]).optional(),
    starred: z.enum(["true", "false"]).optional(),
    unread: z.enum(["true", "false"]).optional(),
    archived: z.enum(["true", "false"]).optional(),
    alerted: z.enum(["true", "false"]).optional(),
    language: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  });

  app.get("/posts", async (c) => {
    const q = feedQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams));
    const page = await queryFeed(c.env.DB, {
      monitorId: q.monitor,
      topic: q.topic,
      authorUsername: q.author,
      dateFrom: q.date_from,
      dateTo: q.date_to,
      minRelevance: q.min_relevance,
      minStrategic: q.min_strategic,
      requiresFollowup: q.requires_followup ? q.requires_followup === "true" : undefined,
      starred: q.starred === "true" ? true : undefined,
      unread: q.unread === "true" ? true : undefined,
      archived: q.archived ? q.archived === "true" : undefined,
      alerted: q.alerted === "true" ? true : undefined,
      language: q.language,
      search: q.search,
      limit: q.limit,
      cursor: q.cursor ?? null,
    });
    return c.json(page);
  });

  app.get("/posts/:id", async (c) => {
    const repo = c.get("repo");
    const post = await repo.getPost(c.req.param("id"));
    if (!post) throw new AppError("NOT_FOUND");
    const [screening, state] = await Promise.all([repo.latestScreening(post.id), repo.getState(post.id)]);
    return c.json({ data: { post, screening, state } });
  });

  const stateBody = z.object({
    is_read: z.boolean().optional(),
    is_starred: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    is_dismissed: z.boolean().optional(),
    notes: z.string().max(4000).nullable().optional(),
  });
  app.patch("/posts/:id/state", async (c) => {
    const repo = c.get("repo");
    const id = c.req.param("id");
    if (!(await repo.getPost(id))) throw new AppError("NOT_FOUND");
    const body = stateBody.parse(await c.req.json());
    await repo.patchState(id, {
      ...(body.is_read !== undefined ? { isRead: body.is_read } : {}),
      ...(body.is_starred !== undefined ? { isStarred: body.is_starred } : {}),
      ...(body.is_archived !== undefined ? { isArchived: body.is_archived } : {}),
      ...(body.is_dismissed !== undefined ? { isDismissed: body.is_dismissed } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
    return c.json({ data: await repo.getState(id) });
  });

  app.post("/posts/:id/alert", async (c) => {
    const repo = c.get("repo");
    const id = c.req.param("id");
    const post = await repo.getPost(id);
    if (!post) throw new AppError("NOT_FOUND");
    const s = await repo.latestScreening(id);
    await repo.createAlert({
      postId: id, monitorId: null, severity: "medium",
      title: `Manual alert: ${post.authorUsername ?? "post"}`,
      reason: s?.summary ?? "Manually flagged by analyst",
    });
    return c.json({ data: { created: true } });
  });

  // Rescreen enqueues a job (spec §56) — actual screening runs in pipeline-worker.
  app.post("/posts/:id/rescreen", async (c) => {
    const repo = c.get("repo");
    const id = c.req.param("id");
    if (!(await repo.getPost(id))) throw new AppError("NOT_FOUND");
    await c.env.SCREENING_QUEUE.send({ schema_version: 1, job_key: `rescreen:${id}:${Date.now()}`, post_id: id, monitor_id: "", prompt_version: "x-intel-screen-v1", force: true });
    return c.json({ data: { enqueued: true } });
  });

  // ── Monitors ───────────────────────────────────────────────────────────────
  app.get("/monitors", async (c) => c.json({ data: await c.get("repo").listMonitors() }));
  app.get("/monitors/:id", async (c) => {
    const m = await c.get("repo").getMonitor(c.req.param("id"));
    if (!m) throw new AppError("NOT_FOUND");
    return c.json({ data: m });
  });

  const monitorBody = z.object({
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
    type: z.enum(["recent_search", "user_watchlist", "x_list", "filtered_stream_rule"]),
    description: z.string().max(1000).optional(),
    x_query: z.string().max(1024).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    poll_interval_minutes: z.number().int().min(5).max(1440).optional(),
    max_results_per_run: z.number().int().min(10).max(100).optional(),
    prefilter_threshold: z.number().int().min(0).max(100).optional(),
    excluded_terms: z.array(z.string()).optional(),
    required_terms: z.array(z.string()).optional(),
  });
  app.post("/monitors", async (c) => {
    const repo = c.get("repo");
    const b = monitorBody.parse(await c.req.json());
    const id = await repo.createMonitor({
      name: b.name, slug: b.slug, type: b.type, description: b.description ?? null,
      xQuery: b.x_query ?? null, priority: b.priority ?? 50, pollIntervalMinutes: b.poll_interval_minutes ?? 60,
      maxResultsPerRun: b.max_results_per_run ?? 25, prefilterThreshold: b.prefilter_threshold ?? 40,
      excludedTerms: b.excluded_terms ?? [], requiredTerms: b.required_terms ?? [], enabled: false,
    });
    return c.json({ data: { id } }, 201);
  });

  app.patch("/monitors/:id", async (c) => {
    const repo = c.get("repo");
    const id = c.req.param("id");
    if (!(await repo.getMonitor(id))) throw new AppError("NOT_FOUND");
    const body = z.object({ enabled: z.boolean().optional() }).parse(await c.req.json());
    if (body.enabled !== undefined) await repo.setMonitorEnabled(id, body.enabled);
    return c.json({ data: await repo.getMonitor(id) });
  });

  app.delete("/monitors/:id", async (c) => {
    await c.get("repo").deleteMonitor(c.req.param("id"));
    return c.json({ data: { deleted: true } });
  });

  // Run now — enqueue a collection job (budget still enforced in pipeline, spec §62).
  app.post("/monitors/:id/run", async (c) => {
    const repo = c.get("repo");
    const m = await repo.getMonitor(c.req.param("id"));
    if (!m) throw new AppError("NOT_FOUND");
    await c.env.INGEST_QUEUE.send({ schema_version: 1, event_id: crypto.randomUUID(), source_type: "recent_search", monitor_id: m.id, received_at: new Date().toISOString(), payload: { trigger: "manual" } });
    return c.json({ data: { enqueued: true, monitor: m.name, max_results: m.maxResultsPerRun } });
  });

  // Test query — validates shape only; a live test is explicit and cost-warned in UI.
  app.post("/monitors/:id/test", async (c) => {
    const m = await c.get("repo").getMonitor(c.req.param("id"));
    if (!m) throw new AppError("NOT_FOUND");
    const valid = typeof m.xQuery === "string" && m.xQuery.trim().length > 0;
    return c.json({ data: { valid, warning: "A live test query may incur X API usage cost." } });
  });

  // ── Alerts ─────────────────────────────────────────────────────────────────
  app.get("/alerts", async (c) => {
    const status = new URL(c.req.url).searchParams.get("status") ?? undefined;
    return c.json({ data: await c.get("repo").listAlerts(status ?? undefined) });
  });
  app.patch("/alerts/:id", async (c) => {
    const body = z.object({ status: z.enum(["open", "acknowledged", "dismissed", "resolved"]) }).parse(await c.req.json());
    await c.get("repo").patchAlert(c.req.param("id"), body.status);
    return c.json({ data: { updated: true } });
  });

  // ── Digests ────────────────────────────────────────────────────────────────
  app.get("/digests", async (c) => c.json({ data: await c.get("repo").listDigests() }));
  app.get("/digests/:id", async (c) => {
    const d = await c.get("repo").getDigest(c.req.param("id"));
    if (!d) throw new AppError("NOT_FOUND");
    return c.json({ data: d });
  });
  app.post("/digests/generate", async (c) => {
    // Delegated to pipeline-worker via a maintenance signal; here we accept & enqueue.
    await c.env.SCREENING_QUEUE.send({ schema_version: 1, job_key: `digest:${Date.now()}`, post_id: "", monitor_id: "", prompt_version: "x-intel-digest-v1", kind: "digest" });
    return c.json({ data: { enqueued: true } });
  });

  // ── Usage ──────────────────────────────────────────────────────────────────
  app.get("/usage/summary", async (c) => {
    const repo = c.get("repo");
    const env = c.get("env");
    const dayIso = new Date(Date.now() - 86_400_000).toISOString();
    const monthIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const pricing = pricingFromEnv(env);
    const [xDay, xMonth, claudeDay] = await Promise.all([
      repo.xResourcesSince(dayIso), repo.xResourcesSince(monthIso), repo.claudeRequestsSince(dayIso),
    ]);
    return c.json({
      data: {
        x_resources_day: xDay,
        x_resources_month: xMonth,
        estimated_x_cost_day_usd: estimateXCost(pricing, xDay),
        claude_requests_day: claudeDay,
        note: "All costs are estimates based on configured unit prices.",
      },
    });
  });
  app.get("/usage/timeseries", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT substr(occurred_at,1,10) AS day, provider, SUM(resource_count) AS resources,
        SUM(request_count) AS requests, SUM(estimated_cost_usd) AS cost
       FROM api_usage WHERE occurred_at >= ? GROUP BY day, provider ORDER BY day`,
    ).bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).all();
    return c.json({ data: results });
  });

  // ── Sources ────────────────────────────────────────────────────────────────
  app.get("/sources", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT p.author_username AS username, p.author_name AS name, COUNT(*) AS posts,
        MIN(p.first_seen_at) AS first_seen, MAX(p.last_seen_at) AS last_seen,
        AVG(s.relevance_score) AS avg_relevance, AVG(s.credibility_score) AS avg_credibility
       FROM posts p LEFT JOIN screening_results s ON s.post_id = p.id
       WHERE p.author_username IS NOT NULL GROUP BY p.author_username ORDER BY posts DESC LIMIT 100`,
    ).all();
    return c.json({ data: results });
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  app.get("/settings", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT key, value_json FROM app_settings WHERE is_secret_reference = 0",
    ).all<{ key: string; value_json: string }>();
    const settings: Record<string, unknown> = {};
    for (const r of results) {
      try {
        settings[r.key] = JSON.parse(r.value_json);
      } catch {
        settings[r.key] = null;
      }
    }
    // Capability flags only — never secret values (spec §6.11).
    const env = c.get("env");
    return c.json({
      data: {
        settings,
        capabilities: {
          x_configured: !!env.X_BEARER_TOKEN,
          claude_configured: !!env.ANTHROPIC_API_KEY && !!env.ANTHROPIC_MODEL,
          webhook_configured: !!env.X_WEBHOOK_SECRET,
          timezone: env.APP_TIMEZONE,
        },
      },
    });
  });
  app.patch("/settings", async (c) => {
    const body = z.record(z.string(), z.unknown()).parse(await c.req.json());
    const repo = c.get("repo");
    for (const [k, v] of Object.entries(body)) {
      if (k.toLowerCase().includes("secret") || k.toLowerCase().includes("token") || k.toLowerCase().includes("key")) continue;
      await repo.setSetting(k, v);
    }
    return c.json({ data: { updated: true } });
  });

  // ── Rules ──────────────────────────────────────────────────────────────────
  app.get("/rules", async (c) => {
    const monitors = await c.get("repo").listMonitors();
    return c.json({
      data: monitors.filter((m) => m.xQuery).map((m) => ({ monitor_id: m.id, name: m.name, query: m.xQuery, active: m.enabled })),
    });
  });
  app.post("/rules/validate", async (c) => {
    const body = z.object({ query: z.string().min(1).max(1024) }).parse(await c.req.json());
    // Structural validation only (balanced quotes/parens). A live X validation is a
    // separate, explicitly cost-warned action.
    const balanced = (s: string, a: string, b: string) => s.split(a).length === s.split(b).length;
    const valid = balanced(body.query, "(", ")") && (body.query.match(/"/g)?.length ?? 0) % 2 === 0;
    return c.json({ data: { valid, note: valid ? "Structurally valid. Confirm against X operators before enabling." : "Unbalanced quotes or parentheses." } });
  });

  // ── System ─────────────────────────────────────────────────────────────────
  app.get("/system/status", async (c) => {
    const env = c.get("env");
    let dbOk = true;
    try {
      await c.env.DB.prepare("SELECT 1").first();
    } catch {
      dbOk = false;
    }
    return c.json({
      data: {
        api: "ok",
        db: dbOk ? "ok" : "error",
        version: env.APP_VERSION,
        environment: env.APP_ENV,
        auth_mode: env.AUTH_MODE,
      },
    });
  });
  app.get("/system/errors", async (c) => {
    const runs = (await c.get("repo").recentRuns(50)).filter((r) => r.status === "failed");
    return c.json({ data: runs });
  });
  app.get("/system/runs", async (c) => c.json({ data: await c.get("repo").recentRuns(50) }));

  return app;
}
