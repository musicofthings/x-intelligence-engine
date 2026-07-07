import { Repositories, type D1Like } from "@xie/db";
import {
  loadEnv, capabilities, pricingFromEnv, estimateXCost, estimateClaudeCost,
  checkXBudget, checkClaudeBudget, PROMPT_VERSIONS, type BudgetLimits, type BudgetState, type Env,
} from "@xie/config";
import { XClient, normalizeSearchResponse, isRepostDuplicate } from "@xie/x-client";
import { prefilter, screenPost, evaluateAlert, type PrefilterContext } from "@xie/screening";
import { createLogger, jobKey, type Logger, type NormalizedXPost } from "@xie/shared";
import type { Bindings, IngestMessage, ScreeningMessage } from "./bindings.js";

const PRIORITY_KEYWORDS = [
  "foundation model", "reasoning model", "ai agent", "protein design", "drug discovery",
  "phase 3", "phase iii", "ctdna", "liquid biopsy", "mrd", "long-read", "nanopore",
  "fda", "accelerated approval", "whole genome", "clinical trial",
];
const STRATEGIC_PHRASES = ["practice-changing", "practice changing", "first-in-class", "breakthrough therapy"];

export interface Ctx {
  env: Env;
  repo: Repositories;
  db: D1Like;
  logger: Logger;
  bindings: Bindings;
}

export function buildCtx(bindings: Bindings): Ctx {
  const env = loadEnv(bindings as unknown as Record<string, unknown>);
  const logger = createLogger({ service: "x-intelligence-pipeline", environment: env.APP_ENV, level: env.LOG_LEVEL });
  return { env, repo: new Repositories(bindings.DB as unknown as D1Like), db: bindings.DB as unknown as D1Like, logger, bindings };
}

function limits(env: Env): BudgetLimits {
  return {
    xDailyResourceBudget: env.X_DAILY_RESOURCE_BUDGET,
    xMonthlyResourceBudget: env.X_MONTHLY_RESOURCE_BUDGET,
    claudeDailyRequestBudget: env.CLAUDE_DAILY_REQUEST_BUDGET,
    hardStop: env.HARD_STOP_ON_BUDGET_EXCEEDED,
  };
}

async function budgetState(repo: Repositories, nowMs: number): Promise<BudgetState> {
  const dayIso = new Date(nowMs - (nowMs % 86_400_000)).toISOString();
  const monthIso = new Date(nowMs - 30 * 86_400_000).toISOString();
  const [xDailyUsed, xMonthlyUsed, claudeDailyRequests] = await Promise.all([
    repo.xResourcesSince(dayIso), repo.xResourcesSince(monthIso), repo.claudeRequestsSince(dayIso),
  ]);
  return { xDailyUsed, xMonthlyUsed, claudeDailyRequests };
}

/** Dispatcher (spec §28/§29): enqueue collect jobs for due monitors. */
export async function dispatchDueMonitors(ctx: Ctx, nowMs: number): Promise<number> {
  const due = await ctx.repo.dueMonitors(nowMs);
  for (const m of due) {
    if (m.type === "filtered_stream_rule") continue; // stream arrives via webhook
    await ctx.bindings.INGEST_QUEUE.send({
      schema_version: 1, event_id: crypto.randomUUID(), source_type: "recent_search",
      monitor_id: m.id, received_at: new Date(nowMs).toISOString(), payload: { trigger: "cron" },
    } satisfies IngestMessage);
  }
  ctx.logger.info("dispatch.done", { event: "dispatch.done", status: due.length });
  return due.length;
}

/** Handle one ingest message: either a webhook payload or a collect trigger. */
export async function handleIngest(ctx: Ctx, msg: IngestMessage, nowMs: number): Promise<void> {
  const caps = capabilities(ctx.env);
  let posts: NormalizedXPost[] = [];
  let monitorId = msg.monitor_id;
  let requested = 0;

  if (msg.source_type === "webhook") {
    // Webhook payloads carry tweets in `data` + includes (structure per X docs).
    posts = normalizeSearchResponse(msg.payload as { data?: never[]; includes?: never });
  } else {
    const monitor = await ctx.repo.getMonitor(monitorId);
    if (!monitor || !monitor.enabled) return;
    if (!caps.xApiConfigured) {
      ctx.logger.warn("collect.x_not_configured", { event: "collect.x_not_configured", monitor_id: monitorId });
      return;
    }
    const runKey = jobKey("collect", monitor.id, Math.floor(nowMs / 60000));
    await ctx.repo.startRun(monitor.id, runKey, "running");

    // Budget gate (spec §30).
    const decision = checkXBudget(await budgetState(ctx.repo, nowMs), limits(ctx.env), monitor.maxResultsPerRun);
    if (!decision.allowed) {
      await ctx.repo.finishRun(runKey, { status: "skipped_budget", error: `budget:${decision.kind}` });
      await ctx.repo.setMonitorRunResult(monitor.id, { lastRunAt: new Date(nowMs).toISOString(), lastError: `budget exceeded: ${decision.kind}` });
      return;
    }

    const client = new XClient({ bearerToken: ctx.env.X_BEARER_TOKEN, baseUrl: ctx.env.X_API_BASE_URL }, fetch);
    try {
      let received = 0;
      if (monitor.type === "recent_search" && monitor.xQuery) {
        const r = await client.recentSearch({ query: monitor.xQuery, maxResults: monitor.maxResultsPerRun, sinceId: monitor.sinceId ?? undefined });
        posts = normalizeSearchResponse(r.data);
        received = r.data.meta?.result_count ?? posts.length;
        requested = monitor.maxResultsPerRun;
      } else if (monitor.type === "x_list" && monitor.xListId) {
        const r = await client.listTimeline(monitor.xListId, { maxResults: monitor.maxResultsPerRun });
        posts = normalizeSearchResponse(r.data);
        received = posts.length;
      }
      const newestId = posts[0]?.xPostId ?? null;
      const pricing = pricingFromEnv(ctx.env);
      await ctx.repo.recordUsage({ provider: "x", operation: monitor.type, monitorId: monitor.id, resourceCount: received, requestCount: 1, estimatedCostUsd: estimateXCost(pricing, received) });
      const processed = await processPosts(ctx, posts, monitor.id, monitor.prefilterThreshold, monitor.priority, nowMs);
      await ctx.repo.finishRun(runKey, {
        status: "success", postsRequested: requested, postsReceived: received,
        postsNew: processed.newCount, postsDuplicate: processed.dupCount, postsEnqueued: processed.enqueued,
        estimatedXCostUsd: estimateXCost(pricing, received),
      });
      await ctx.repo.setMonitorRunResult(monitor.id, { lastRunAt: new Date(nowMs).toISOString(), lastSuccessAt: new Date(nowMs).toISOString(), lastError: null, sinceId: newestId });
      return;
    } catch (e) {
      const message = e instanceof Error ? e.message : "collection failed";
      await ctx.repo.finishRun(runKey, { status: "failed", error: message });
      await ctx.repo.setMonitorRunResult(monitor.id, { lastRunAt: new Date(nowMs).toISOString(), lastError: message });
      throw e; // let the queue retry per policy
    }
  }

  // Webhook path: process posts against the (optional) monitor.
  if (posts.length) await processPosts(ctx, posts, monitorId || "webhook", 40, 50, nowMs);
}

/** Upsert + match + prefilter + enqueue-if-qualified. Idempotent throughout. */
export async function processPosts(
  ctx: Ctx, posts: NormalizedXPost[], monitorId: string, prefilterThreshold: number, authorPriority: number, nowMs: number,
): Promise<{ newCount: number; dupCount: number; enqueued: number }> {
  let newCount = 0, dupCount = 0, enqueued = 0;
  for (const post of posts) {
    const { id, isNew } = await ctx.repo.upsertPost(post);
    if (isNew) newCount++; else dupCount++;
    if (monitorId && monitorId !== "webhook") await ctx.repo.recordMatch(id, monitorId, "monitor");

    const matchCount = await ctx.repo.monitorMatchCount(id);
    const ctxPf: PrefilterContext = {
      authorPriority, priorityKeywords: PRIORITY_KEYWORDS, strategicPhrases: STRATEGIC_PHRASES,
      excludedTerms: [], monitorMatchCount: matchCount,
      isRepostDuplicate: isRepostDuplicate(post.raw as never), threshold: prefilterThreshold,
    };
    const pf = prefilter(post, ctxPf);
    await ctx.repo.savePrefilter(id, pf);

    if (pf.decision === "pass" && isNew) {
      await ctx.bindings.SCREENING_QUEUE.send({
        schema_version: 1, job_key: jobKey("screen", id, PROMPT_VERSIONS.screen),
        post_id: id, monitor_id: monitorId, prompt_version: PROMPT_VERSIONS.screen,
      } satisfies ScreeningMessage);
      enqueued++;
    }
  }
  return { newCount, dupCount, enqueued };
}

/** Screening consumer: Claude call + persist + alert + usage (idempotent). */
export async function handleScreening(ctx: Ctx, msg: ScreeningMessage, nowMs: number): Promise<void> {
  if (msg.kind === "digest") return; // digest handled by cron

  const caps = capabilities(ctx.env);
  if (!caps.claudeConfigured) {
    ctx.logger.warn("screen.claude_not_configured", { event: "screen.claude_not_configured", post_id: msg.post_id });
    return;
  }
  const model = ctx.env.ANTHROPIC_MODEL;
  if (!msg.force && (await ctx.repo.isAlreadyScreened(msg.post_id, model, msg.prompt_version))) return;

  const post = await ctx.repo.getPost(msg.post_id);
  if (!post) return;

  const decision = checkClaudeBudget(await budgetState(ctx.repo, nowMs), limits(ctx.env));
  if (!decision.allowed) {
    ctx.logger.warn("screen.budget_exceeded", { event: "screen.budget_exceeded", post_id: msg.post_id });
    return;
  }

  const monitor = msg.monitor_id ? await ctx.repo.getMonitor(msg.monitor_id) : null;
  const resp = await screenPost(
    { apiKey: ctx.env.ANTHROPIC_API_KEY, model },
    {
      monitor: { monitorName: monitor?.name ?? "General", monitorDescription: monitor?.description ?? null },
      post: { text: post.text, authorUsername: post.authorUsername, createdAt: post.createdAt, lang: post.lang },
    },
    fetch,
  );

  const pricing = pricingFromEnv(ctx.env);
  const cost = estimateClaudeCost(pricing, resp.inputTokens ?? 0, resp.outputTokens ?? 0);
  await ctx.repo.saveScreening(post.id, "anthropic", resp.model, resp.promptVersion, resp.result,
    { inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, estimatedCostUsd: cost }, resp.result);
  await ctx.repo.recordUsage({ provider: "anthropic", operation: "screen", monitorId: monitor?.id ?? null, requestCount: 1, inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, estimatedCostUsd: cost });

  const alert = evaluateAlert({
    screening: resp.result, alertThreshold: monitor?.alertThreshold ?? 90,
    monitorName: monitor?.name ?? "General", authorUsername: post.authorUsername,
  });
  if (alert.shouldAlert) {
    await ctx.repo.createAlert({ postId: post.id, monitorId: monitor?.id ?? null, severity: alert.severity, title: alert.title, reason: alert.reason });
    await deliverAlertWebhook(ctx, alert.title, alert.reason);
  }
}

async function deliverAlertWebhook(ctx: Ctx, title: string, reason: string): Promise<void> {
  const url = ctx.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, reason }) });
  } catch (e) {
    ctx.logger.warn("alert.delivery_failed", { event: "alert.delivery_failed", error_code: e instanceof Error ? e.message : "err" });
  }
}
