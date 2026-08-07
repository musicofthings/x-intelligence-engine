import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  AppError,
  decryptSecret,
  encryptSecret,
  importEncryptionKey,
  type Network,
  type ReplyTransform,
} from "@xie/shared";
import { capabilities, checkClaudeBudget, estimateClaudeCost, pricingFromEnv, type Env } from "@xie/config";
import { checkReply, draftReply, rankQueue, EMPTY_SIGNALS, type RankInput } from "@xie/engage";
import { beginAuthorization, exchangeCode, refreshAccessToken, isExpired, XWriteClient } from "@xie/x-client";
import { RedditClient, buildRedditQuery, cleanSubreddit, normalizeRedditListing } from "@xie/reddit-client";
import type { HonoEnv } from "./bindings.js";

/**
 * Engagement routes (spec §63): campaigns, voice profiles, the engage inbox, AI reply
 * drafting + transforms, deterministic pre-send checks, one-click send under user-context
 * OAuth, session/goal tracking, and Reddit campaign setup.
 *
 * Safety invariants enforced here, not just in the UI:
 *   - There is NO endpoint that sends without an explicit per-reply request.
 *   - Every send passes the deterministic safety check; hard blocks are never bypassable.
 *   - Every send takes a UNIQUE idempotency claim before the network call, so an
 *     at-least-once retry can never double-post.
 *   - OAuth tokens are AES-GCM encrypted at rest and never returned to the browser.
 */

/** Single-account app: one connected X identity. */
const X_ACCOUNT_KEY = "x:default";

const globalFetch: typeof fetch = (input, init) => fetch(input, init);

export function engageRoutes(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  // ── Voice profiles ─────────────────────────────────────────────────────────
  const voiceBody = z.object({
    name: z.string().min(1).max(120),
    tone: z.string().max(400).optional(),
    audience: z.string().max(400).nullable().optional(),
    perspective: z.string().max(400).nullable().optional(),
    do: z.array(z.string().max(200)).max(20).optional(),
    dont: z.array(z.string().max(200)).max(20).optional(),
    sample_replies: z.array(z.string().max(600)).max(10).optional(),
    max_chars: z.number().int().min(40).max(2000).optional(),
  });

  app.get("/voice-profiles", async (c) => c.json({ data: await c.get("repo").engage.listVoiceProfiles() }));

  app.post("/voice-profiles", async (c) => {
    const b = voiceBody.parse(await c.req.json());
    const id = await c.get("repo").engage.createVoiceProfile({
      name: b.name, tone: b.tone ?? "direct, factual, collegial",
      audience: b.audience ?? null, perspective: b.perspective ?? null,
      do: b.do ?? [], dont: b.dont ?? [], sampleReplies: b.sample_replies ?? [],
      maxChars: b.max_chars ?? 260,
    });
    return c.json({ data: { id } }, 201);
  });

  app.patch("/voice-profiles/:id", async (c) => {
    const repo = c.get("repo").engage;
    const id = c.req.param("id");
    if (!(await repo.getVoiceProfile(id))) throw new AppError("NOT_FOUND");
    const b = voiceBody.partial().parse(await c.req.json());
    await repo.updateVoiceProfile(id, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.tone !== undefined ? { tone: b.tone } : {}),
      ...(b.audience !== undefined ? { audience: b.audience } : {}),
      ...(b.perspective !== undefined ? { perspective: b.perspective } : {}),
      ...(b.do !== undefined ? { do: b.do } : {}),
      ...(b.dont !== undefined ? { dont: b.dont } : {}),
      ...(b.sample_replies !== undefined ? { sampleReplies: b.sample_replies } : {}),
      ...(b.max_chars !== undefined ? { maxChars: b.max_chars } : {}),
    });
    return c.json({ data: await repo.getVoiceProfile(id) });
  });

  app.delete("/voice-profiles/:id", async (c) => {
    await c.get("repo").engage.deleteVoiceProfile(c.req.param("id"));
    return c.json({ data: { deleted: true } });
  });

  // ── Campaigns ──────────────────────────────────────────────────────────────
  const campaignBody = z.object({
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
    description: z.string().max(1000).nullable().optional(),
    networks: z.array(z.enum(["x", "reddit"])).min(1).max(2).optional(),
    goal_replies_per_day: z.number().int().min(0).max(200).optional(),
    voice_profile_id: z.string().max(80).nullable().optional(),
    strategy: z.string().max(4000).nullable().optional(),
  });

  app.get("/campaigns", async (c) => c.json({ data: await c.get("repo").engage.listCampaigns() }));

  app.get("/campaigns/:id", async (c) => {
    const repo = c.get("repo");
    const campaign = await repo.engage.getCampaign(c.req.param("id"));
    if (!campaign) throw new AppError("NOT_FOUND");
    const monitorIds = await repo.engage.campaignMonitorIds(campaign.id);
    const allMonitors = await repo.listMonitors();
    return c.json({
      data: {
        campaign,
        monitors: allMonitors.filter((m) => monitorIds.includes(m.id)),
        available_monitors: allMonitors.filter((m) => !monitorIds.includes(m.id)),
        voice: campaign.voiceProfileId ? await repo.engage.getVoiceProfile(campaign.voiceProfileId) : null,
      },
    });
  });

  app.post("/campaigns", async (c) => {
    const b = campaignBody.parse(await c.req.json());
    const id = await c.get("repo").engage.createCampaign({
      name: b.name, slug: b.slug, description: b.description ?? null,
      networks: b.networks ?? ["x"], goalRepliesPerDay: b.goal_replies_per_day ?? 10,
      voiceProfileId: b.voice_profile_id ?? null, strategy: b.strategy ?? null,
    });
    return c.json({ data: { id } }, 201);
  });

  app.patch("/campaigns/:id", async (c) => {
    const repo = c.get("repo").engage;
    const id = c.req.param("id");
    if (!(await repo.getCampaign(id))) throw new AppError("NOT_FOUND");
    const b = campaignBody.partial().extend({ enabled: z.boolean().optional() }).parse(await c.req.json());
    await repo.updateCampaign(id, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      ...(b.networks !== undefined ? { networks: b.networks } : {}),
      ...(b.goal_replies_per_day !== undefined ? { goalRepliesPerDay: b.goal_replies_per_day } : {}),
      ...(b.voice_profile_id !== undefined ? { voiceProfileId: b.voice_profile_id } : {}),
      ...(b.strategy !== undefined ? { strategy: b.strategy } : {}),
    });
    return c.json({ data: await repo.getCampaign(id) });
  });

  app.delete("/campaigns/:id", async (c) => {
    await c.get("repo").engage.deleteCampaign(c.req.param("id"));
    return c.json({ data: { deleted: true } });
  });

  app.post("/campaigns/:id/monitors", async (c) => {
    const repo = c.get("repo");
    const id = c.req.param("id");
    if (!(await repo.engage.getCampaign(id))) throw new AppError("NOT_FOUND");
    const b = z.object({ monitor_id: z.string().min(1).max(80) }).parse(await c.req.json());
    if (!(await repo.getMonitor(b.monitor_id))) throw new AppError("NOT_FOUND");
    await repo.engage.linkMonitor(id, b.monitor_id);
    return c.json({ data: { linked: true } });
  });

  app.delete("/campaigns/:id/monitors/:monitorId", async (c) => {
    await c.get("repo").engage.unlinkMonitor(c.req.param("id"), c.req.param("monitorId"));
    return c.json({ data: { unlinked: true } });
  });

  /** Drop one network from a campaign without deleting the campaign. */
  app.post("/campaigns/:id/detach-network", async (c) => {
    const repo = c.get("repo").engage;
    const id = c.req.param("id");
    if (!(await repo.getCampaign(id))) throw new AppError("NOT_FOUND");
    const b = z.object({ network: z.enum(["x", "reddit"]) }).parse(await c.req.json());
    const unlinked = await repo.detachNetwork(id, b.network);
    await c.get("repo").writeAudit(c.get("actor"), "campaign_detach_network", "campaign", id, {
      network: b.network, monitors_unlinked: unlinked,
    });
    return c.json({ data: { detached: b.network, monitors_unlinked: unlinked } });
  });

  // ── Engage inbox ───────────────────────────────────────────────────────────
  app.get("/engage/queue", async (c) => {
    const repo = c.get("repo");
    const q = z
      .object({
        campaign: z.string().optional(),
        network: z.enum(["x", "reddit"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        hours: z.coerce.number().int().min(1).max(720).optional(),
        min_score: z.coerce.number().int().min(0).max(100).optional(),
      })
      .parse(Object.fromEntries(new URL(c.req.url).searchParams));

    const nowMs = Date.now();
    const minStrategic = q.min_score ?? (await repo.getSetting<number>("engage.min_strategic_score")) ?? 40;
    const limit = q.limit ?? (await repo.getSetting<number>("engage.queue_limit")) ?? 50;

    const candidates = await repo.engage.engageCandidates({
      campaignId: q.campaign ?? null,
      network: q.network ?? null,
      minStrategic,
      sinceIso: new Date(nowMs - (q.hours ?? 72) * 3_600_000).toISOString(),
      limit,
    });

    const signals = await repo.engage.engagementSignals(q.campaign ?? null);
    const ranked = rankQueue(
      candidates.map<RankInput>((x) => ({
        postId: x.postId, authorUsername: x.authorUsername, topic: x.topic, createdAt: x.createdAt,
        strategicScore: x.strategicScore, relevanceScore: x.relevanceScore,
        replyCount: x.replyCount, likeCount: x.likeCount,
        hasDraft: x.draftCount > 0, hasReply: x.hasReply > 0,
      })),
      signals,
      nowMs,
    );

    const byId = new Map(candidates.map((x) => [x.postId, x]));
    const data = ranked.flatMap((r) => {
      const x = byId.get(r.postId);
      if (!x) return [];
      return [{
        post: {
          id: x.postId, network: x.network, xPostId: x.xPostId, authorUsername: x.authorUsername,
          authorName: x.authorName, text: x.text, url: x.url, createdAt: x.createdAt,
          metrics: {
            likeCount: x.likeCount, repostCount: 0, replyCount: x.replyCount,
            quoteCount: 0, bookmarkCount: 0, impressionCount: 0,
          },
        },
        topic: x.topic, strategicScore: x.strategicScore, relevanceScore: x.relevanceScore,
        summary: x.summary, queueScore: r.queueScore, reasons: r.reasons,
        draftCount: x.draftCount,
        monitorNames: x.monitorNames ? x.monitorNames.split(", ").filter(Boolean) : [],
      }];
    });

    return c.json({
      data,
      meta: {
        candidates: candidates.length,
        signals_observed: signals.totalEngaged + signals.totalSkipped,
        min_strategic_score: minStrategic,
      },
    });
  });

  // ── Sessions + goals ───────────────────────────────────────────────────────
  app.post("/engage/sessions", async (c) => {
    const repo = c.get("repo");
    const b = z
      .object({ campaign_id: z.string().max(80).nullable().optional(), goal: z.number().int().min(0).max(200).optional() })
      .parse(await c.req.json().catch(() => ({})));
    const campaign = b.campaign_id ? await repo.engage.getCampaign(b.campaign_id) : null;
    const goal = b.goal ?? campaign?.goalRepliesPerDay ?? (await repo.getSetting<number>("engage.daily_goal")) ?? 10;
    const id = await repo.engage.startSession(b.campaign_id ?? null, goal);
    return c.json({ data: await repo.engage.getSession(id) }, 201);
  });

  app.get("/engage/sessions", async (c) => c.json({ data: await c.get("repo").engage.listSessions(30) }));

  app.get("/engage/sessions/:id", async (c) => {
    const repo = c.get("repo").engage;
    const s = await repo.getSession(c.req.param("id"));
    if (!s) throw new AppError("NOT_FOUND");
    return c.json({ data: { session: s, live: await repo.sessionLiveStats(s.id) } });
  });

  app.post("/engage/sessions/:id/end", async (c) => {
    const repo = c.get("repo").engage;
    const s = await repo.endSession(c.req.param("id"));
    if (!s) throw new AppError("NOT_FOUND");
    return c.json({ data: s });
  });

  /** Triage decision. Skips are as informative as engagements — both train the ranker. */
  app.post("/engage/events", async (c) => {
    const repo = c.get("repo");
    const b = z
      .object({
        post_id: z.string().min(1).max(80),
        kind: z.enum(["engaged", "skipped", "replied", "followed", "drafted"]),
        session_id: z.string().max(80).nullable().optional(),
        campaign_id: z.string().max(80).nullable().optional(),
      })
      .parse(await c.req.json());
    if (!(await repo.getPost(b.post_id))) throw new AppError("NOT_FOUND");
    await repo.engage.recordEvent({
      sessionId: b.session_id ?? null, campaignId: b.campaign_id ?? null,
      postId: b.post_id, kind: b.kind,
    });
    // A triaged item is a read item — keep the intelligence feed consistent.
    await repo.patchState(b.post_id, { isRead: true, ...(b.kind === "skipped" ? { isDismissed: true } : {}) });
    return c.json({ data: { recorded: true } });
  });

  /** Daily goal progress + rolling session history. */
  app.get("/engage/stats", async (c) => {
    const repo = c.get("repo");
    const days = z.coerce.number().int().min(1).max(90).catch(14).parse(new URL(c.req.url).searchParams.get("days") ?? 14);
    const nowMs = Date.now();
    const dayStart = new Date(nowMs - (nowMs % 86_400_000)).toISOString();

    const [goal, sentToday, sessions, signals] = await Promise.all([
      repo.getSetting<number>("engage.daily_goal"),
      repo.engage.sentCountSince(dayStart),
      repo.engage.listSessions(days),
      repo.engage.engagementSignals(null),
    ]);

    const { results } = await c.env.DB.prepare(
      `SELECT substr(sent_at,1,10) AS day, COUNT(*) AS replies
       FROM sent_replies WHERE sent_at >= ? GROUP BY day ORDER BY day`,
    ).bind(new Date(nowMs - days * 86_400_000).toISOString()).all();

    return c.json({
      data: {
        daily_goal: goal ?? 10,
        replies_today: sentToday,
        goal_met: sentToday >= (goal ?? 10),
        by_day: results,
        recent_sessions: sessions,
        learning: {
          observations: signals.totalEngaged + signals.totalSkipped,
          engaged: signals.totalEngaged,
          skipped: signals.totalSkipped,
          top_authors: topN(signals.authorAffinity, 10),
          top_topics: topN(signals.topicAffinity, 10),
        },
      },
    });
  });

  // ── Drafting ───────────────────────────────────────────────────────────────
  app.get("/posts/:id/drafts", async (c) =>
    c.json({ data: await c.get("repo").engage.listDraftsForPost(c.req.param("id")) }));

  /** Generate an AI draft for a post. Budget-gated and usage-accounted like screening. */
  app.post("/posts/:id/drafts", async (c) => {
    const repo = c.get("repo");
    const env = c.get("env");
    const postId = c.req.param("id");
    const post = await repo.getPost(postId);
    if (!post) throw new AppError("NOT_FOUND");

    const b = z
      .object({
        campaign_id: z.string().max(80).nullable().optional(),
        voice_profile_id: z.string().max(80).nullable().optional(),
        session_id: z.string().max(80).nullable().optional(),
      })
      .parse(await c.req.json().catch(() => ({})));

    if (!capabilities(env).claudeConfigured) {
      throw new AppError("CONFIGURATION_ERROR", "Claude is not configured — cannot draft replies");
    }
    await assertClaudeBudget(c);

    const campaign = b.campaign_id ? await repo.engage.getCampaign(b.campaign_id) : null;
    const voiceId = b.voice_profile_id ?? campaign?.voiceProfileId ?? null;
    const voice = voiceId ? await repo.engage.getVoiceProfile(voiceId) : null;
    const maxChars = maxCharsFor(post.network ?? "x", voice?.maxChars ?? null, env);
    const screening = await repo.latestScreening(postId);

    const resp = await draftReply(
      { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL },
      {
        post: {
          network: post.network ?? "x", authorUsername: post.authorUsername, text: post.text,
          createdAt: post.createdAt, summary: screening?.summary ?? null, topic: screening?.topic ?? null,
        },
        voice, maxChars, strategy: campaign?.strategy ?? null,
      },
      globalFetch,
    );

    const cost = estimateClaudeCost(pricingFromEnv(env), resp.inputTokens ?? 0, resp.outputTokens ?? 0);
    const id = await repo.engage.createDraft({
      postId, campaignId: campaign?.id ?? null, voiceProfileId: voiceId, body: resp.reply,
      source: "ai", model: resp.model, promptVersion: resp.promptVersion,
      inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, estimatedCostUsd: cost,
    });
    await repo.recordUsage({
      provider: "anthropic", operation: "reply_draft", monitorId: null, requestCount: 1,
      inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, estimatedCostUsd: cost,
    });
    await repo.engage.recordEvent({
      sessionId: b.session_id ?? null, campaignId: campaign?.id ?? null, postId, kind: "drafted",
    });

    const draft = await repo.engage.getDraft(id);
    return c.json({
      data: { draft, rationale: resp.rationale, safety: await runSafety(c, resp.reply, maxChars) },
    }, 201);
  });

  /** Rewrite / autocomplete / shorter / longer — same voice, new draft row. */
  app.post("/drafts/:id/transform", async (c) => {
    const repo = c.get("repo");
    const env = c.get("env");
    const draft = await repo.engage.getDraft(c.req.param("id"));
    if (!draft) throw new AppError("NOT_FOUND");
    const post = await repo.getPost(draft.postId);
    if (!post) throw new AppError("NOT_FOUND");

    const b = z
      .object({
        transform: z.enum(["rewrite", "autocomplete", "shorter", "longer"]),
        body: z.string().max(4000).optional(),
      })
      .parse(await c.req.json());

    if (!capabilities(env).claudeConfigured) {
      throw new AppError("CONFIGURATION_ERROR", "Claude is not configured — cannot transform drafts");
    }
    await assertClaudeBudget(c);

    // Prefer the caller's in-progress text so unsaved edits are not silently discarded.
    const current = (b.body ?? draft.body).trim();
    if (!current) throw new AppError("VALIDATION_ERROR", "Nothing to transform");

    const campaign = draft.campaignId ? await repo.engage.getCampaign(draft.campaignId) : null;
    const voice = draft.voiceProfileId ? await repo.engage.getVoiceProfile(draft.voiceProfileId) : null;
    const maxChars = maxCharsFor(post.network ?? "x", voice?.maxChars ?? null, env);
    const screening = await repo.latestScreening(post.id);

    const resp = await draftReply(
      { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL },
      {
        post: {
          network: post.network ?? "x", authorUsername: post.authorUsername, text: post.text,
          createdAt: post.createdAt, summary: screening?.summary ?? null, topic: screening?.topic ?? null,
        },
        voice, maxChars, strategy: campaign?.strategy ?? null,
        currentDraft: current, transform: b.transform as ReplyTransform,
      },
      globalFetch,
    );

    const cost = estimateClaudeCost(pricingFromEnv(env), resp.inputTokens ?? 0, resp.outputTokens ?? 0);
    const id = await repo.engage.createDraft({
      postId: post.id, campaignId: draft.campaignId, voiceProfileId: draft.voiceProfileId,
      body: resp.reply, source: "transform", model: resp.model, promptVersion: resp.promptVersion,
      inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, estimatedCostUsd: cost,
    });
    await repo.recordUsage({
      provider: "anthropic", operation: `reply_${b.transform}`, monitorId: null, requestCount: 1,
      inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, estimatedCostUsd: cost,
    });

    return c.json({
      data: {
        draft: await repo.engage.getDraft(id),
        rationale: resp.rationale,
        safety: await runSafety(c, resp.reply, maxChars),
      },
    }, 201);
  });

  /** Save a hand-edited draft body. */
  app.patch("/drafts/:id", async (c) => {
    const repo = c.get("repo");
    const id = c.req.param("id");
    const draft = await repo.engage.getDraft(id);
    if (!draft) throw new AppError("NOT_FOUND");
    if (draft.status !== "draft") throw new AppError("VALIDATION_ERROR", "This draft has already been sent or discarded");
    const b = z.object({ body: z.string().min(1).max(4000) }).parse(await c.req.json());
    await repo.engage.updateDraftBody(id, b.body);
    return c.json({ data: await repo.engage.getDraft(id) });
  });

  app.delete("/drafts/:id", async (c) => {
    await c.get("repo").engage.setDraftStatus(c.req.param("id"), "discarded");
    return c.json({ data: { discarded: true } });
  });

  /** Pre-send check for arbitrary text — the UI calls this as the analyst types. */
  app.post("/engage/check", async (c) => {
    const b = z
      .object({ body: z.string().max(4000), network: z.enum(["x", "reddit"]).optional() })
      .parse(await c.req.json());
    const maxChars = maxCharsFor(b.network ?? "x", null, c.get("env"));
    return c.json({ data: await runSafety(c, b.body, maxChars) });
  });

  // ── Send ───────────────────────────────────────────────────────────────────
  /**
   * Publish one reply. Requires an explicit request per reply — there is no bulk or
   * scheduled path. The idempotency claim is taken BEFORE the X call, so a retried
   * request returns the original result instead of posting twice.
   */
  app.post("/drafts/:id/send", async (c) => {
    const repo = c.get("repo");
    const env = c.get("env");
    const draft = await repo.engage.getDraft(c.req.param("id"));
    if (!draft) throw new AppError("NOT_FOUND");
    const post = await repo.getPost(draft.postId);
    if (!post) throw new AppError("NOT_FOUND");

    const b = z
      .object({
        body: z.string().max(4000).optional(),
        session_id: z.string().max(80).nullable().optional(),
        /** Dismissed warn-level codes. Hard blocks are never bypassable. */
        acknowledged_warnings: z.array(z.string().max(40)).max(20).optional(),
      })
      .parse(await c.req.json().catch(() => ({})));

    const network: Network = (post.network ?? "x") as Network;
    if (network !== "x") {
      throw new AppError("VALIDATION_ERROR", "Sending is only supported on X; open the Reddit thread to reply there");
    }
    if (draft.status === "sent") throw new AppError("VALIDATION_ERROR", "This draft has already been sent");

    const body = (b.body ?? draft.body).trim();
    const maxChars = maxCharsFor(network, null, env);

    const safety = await runSafety(c, body, maxChars);
    if (!safety.sendable) {
      throw new AppError("VALIDATION_ERROR", "Reply failed a blocking pre-send check", {
        issues: safety.warnings
          .filter((w) => w.severity === "block")
          .map((w) => ({ path: w.code, message: w.message })),
      });
    }

    // Daily send cap — a blunt backstop against a runaway session.
    const dayStart = new Date(Date.now() - (Date.now() % 86_400_000)).toISOString();
    const sentToday = await repo.engage.sentCountSince(dayStart);
    if (sentToday >= env.ENGAGE_DAILY_SEND_CAP) {
      throw new AppError("BUDGET_EXCEEDED", `Daily send cap of ${env.ENGAGE_DAILY_SEND_CAP} replies reached`);
    }

    // Claim first. A duplicate claim means this exact draft was already sent.
    const key = `reply:${draft.id}`;
    const existing = await repo.engage.getSentReplyByKey(key);
    if (existing) {
      return c.json({ data: { sent: true, already_sent: true, reply: existing } });
    }
    const claimId = await repo.engage.claimSend(key, {
      draftId: draft.id, postId: post.id, campaignId: draft.campaignId, network, body,
    });
    if (!claimId) {
      const race = await repo.engage.getSentReplyByKey(key);
      return c.json({ data: { sent: true, already_sent: true, reply: race } });
    }

    try {
      const accessToken = await userAccessToken(c);
      const client = new XWriteClient({ accessToken, baseUrl: env.X_API_BASE_URL }, globalFetch);
      const posted = await client.replyTo(post.xPostId, body);

      await repo.engage.recordSendResult(claimId, posted.id);
      await repo.engage.setDraftStatus(draft.id, "sent");
      await repo.engage.recordEvent({
        sessionId: b.session_id ?? null, campaignId: draft.campaignId, postId: post.id, kind: "replied",
        metadata: { external_reply_id: posted.id, acknowledged: b.acknowledged_warnings ?? [] },
      });
      await repo.patchState(post.id, { isRead: true });
      await repo.writeAudit(c.get("actor"), "reply_sent", "post", post.id, {
        draft_id: draft.id, external_reply_id: posted.id, chars: body.length,
      });

      return c.json({
        data: {
          sent: true,
          already_sent: false,
          external_reply_id: posted.id,
          url: post.authorUsername ? `https://x.com/i/web/status/${posted.id}` : null,
        },
      });
    } catch (e) {
      // Release the claim so the analyst can retry after fixing the cause.
      await repo.engage.releaseSend(claimId);
      throw e;
    }
  });

  app.get("/engage/replies", async (c) => c.json({ data: await c.get("repo").engage.listSentReplies(50) }));

  // ── X OAuth (user context) ─────────────────────────────────────────────────
  app.get("/oauth/x/status", async (c) => {
    const env = c.get("env");
    const caps = capabilities(env);
    const tok = await c.get("repo").engage.getOAuthToken(X_ACCOUNT_KEY);
    return c.json({
      data: {
        configured: caps.xWriteConfigured,
        connected: !!tok,
        // Identity only — token material is never serialized to the browser.
        username: tok?.username ?? null,
        scope: tok?.scope ?? null,
        expires_at: tok?.expiresAt ?? null,
        missing: caps.xWriteConfigured
          ? []
          : [
              !env.X_OAUTH_CLIENT_ID && "X_OAUTH_CLIENT_ID",
              !env.X_OAUTH_REDIRECT_URI && "X_OAUTH_REDIRECT_URI",
              !env.TOKEN_ENCRYPTION_KEY && "TOKEN_ENCRYPTION_KEY",
            ].filter(Boolean),
      },
    });
  });

  app.post("/oauth/x/start", async (c) => {
    const env = c.get("env");
    if (!capabilities(env).xWriteConfigured) {
      throw new AppError("CONFIGURATION_ERROR", "X OAuth is not configured");
    }
    const handshake = await beginAuthorization(oauthConfig(env));
    await c.get("repo").engage.saveOAuthState(handshake.state, handshake.codeVerifier, env.X_OAUTH_REDIRECT_URI);
    return c.json({ data: { authorize_url: handshake.url } });
  });

  /** X redirects the analyst's browser here. Still behind Cloudflare Access. */
  app.get("/oauth/x/callback", async (c) => {
    const env = c.get("env");
    const repo = c.get("repo");
    const url = new URL(c.req.url);
    const err = url.searchParams.get("error");
    if (err) return c.redirect(`/settings?x_oauth=denied`, 302);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new AppError("VALIDATION_ERROR", "Missing code or state");

    const saved = await repo.engage.consumeOAuthState(state);
    if (!saved) throw new AppError("AUTHENTICATION_ERROR", "OAuth state is unknown or expired");

    const tokens = await exchangeCode(oauthConfig(env), { code, codeVerifier: saved.codeVerifier }, globalFetch);

    let username: string | null = null;
    let externalUserId: string | null = null;
    try {
      const me = await new XWriteClient({ accessToken: tokens.accessToken, baseUrl: env.X_API_BASE_URL }, globalFetch).me();
      username = me.username;
      externalUserId = me.id;
    } catch {
      // Identity lookup is a nicety; the connection is still usable without it.
    }

    const key = await importEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
    await repo.engage.saveOAuthToken({
      accountKey: X_ACCOUNT_KEY, network: "x", externalUserId, username,
      accessTokenEnc: await encryptSecret(key, tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? await encryptSecret(key, tokens.refreshToken) : null,
      scope: tokens.scope, expiresAt: tokens.expiresAt,
    });
    await repo.writeAudit(c.get("actor"), "x_account_connected", "oauth", X_ACCOUNT_KEY, { username });

    return c.redirect(`/settings?x_oauth=connected`, 302);
  });

  app.delete("/oauth/x", async (c) => {
    await c.get("repo").engage.deleteOAuthToken(X_ACCOUNT_KEY);
    await c.get("repo").writeAudit(c.get("actor"), "x_account_disconnected", "oauth", X_ACCOUNT_KEY);
    return c.json({ data: { disconnected: true } });
  });

  // ── Reddit campaign setup ──────────────────────────────────────────────────
  app.get("/reddit/status", async (c) => {
    const caps = capabilities(c.get("env"));
    const env = c.get("env");
    return c.json({
      data: {
        configured: caps.redditConfigured,
        missing: caps.redditConfigured
          ? []
          : [
              !env.REDDIT_CLIENT_ID && "REDDIT_CLIENT_ID",
              !env.REDDIT_CLIENT_SECRET && "REDDIT_CLIENT_SECRET",
              !env.REDDIT_USER_AGENT && "REDDIT_USER_AGENT",
            ].filter(Boolean),
      },
    });
  });

  /** Validate a subreddit and report its size — the "smarter discovery" setup step. */
  app.post("/reddit/subreddits/validate", async (c) => {
    const env = c.get("env");
    if (!capabilities(env).redditConfigured) throw new AppError("CONFIGURATION_ERROR", "Reddit is not configured");
    const b = z.object({ subreddit: z.string().min(1).max(60) }).parse(await c.req.json());
    const name = cleanSubreddit(b.subreddit);
    if (!name) throw new AppError("VALIDATION_ERROR", "Not a valid subreddit name");

    const client = new RedditClient(redditConfig(env), globalFetch);
    try {
      const r = await client.subredditAbout(name);
      const d = r.data.data ?? {};
      return c.json({
        data: {
          valid: true, name: d.display_name ?? name, subscribers: d.subscribers ?? null,
          description: (d.public_description ?? "").slice(0, 300), over18: !!d.over18,
        },
      });
    } catch {
      return c.json({ data: { valid: false, name, subscribers: null, description: "", over18: false } });
    }
  });

  /**
   * Dry-run a Reddit monitor: how many posts a run would surface and what they look
   * like, so expected volume is visible before the monitor is enabled.
   */
  app.post("/reddit/preview", async (c) => {
    const env = c.get("env");
    if (!capabilities(env).redditConfigured) throw new AppError("CONFIGURATION_ERROR", "Reddit is not configured");
    const b = z
      .object({
        keywords: z.array(z.string().min(1).max(80)).max(10).optional(),
        subreddits: z.array(z.string().min(1).max(60)).max(10).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(await c.req.json());

    const keywords = b.keywords ?? [];
    const subreddits = (b.subreddits ?? []).map(cleanSubreddit).filter(Boolean);
    if (!keywords.length && !subreddits.length) {
      throw new AppError("VALIDATION_ERROR", "Provide at least one keyword or subreddit");
    }

    const client = new RedditClient(redditConfig(env), globalFetch);
    const query = buildRedditQuery(keywords);
    const r = query
      ? await client.search({ query, subreddits, limit: b.limit ?? 25, sort: "new" })
      : await client.subredditNew(subreddits, { limit: b.limit ?? 25 });
    const { posts } = normalizeRedditListing(r.data);

    return c.json({
      data: {
        query: query || `r/${subreddits.join("+")} (new)`,
        matched: posts.length,
        rate_limit: r.rateLimit,
        sample: posts.slice(0, 10).map((p) => ({
          id: p.xPostId, author: p.authorUsername, created_at: p.createdAt,
          text: p.text.slice(0, 240), url: p.url,
        })),
      },
    });
  });

  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function oauthConfig(env: Env) {
  return {
    clientId: env.X_OAUTH_CLIENT_ID,
    ...(env.X_OAUTH_CLIENT_SECRET ? { clientSecret: env.X_OAUTH_CLIENT_SECRET } : {}),
    redirectUri: env.X_OAUTH_REDIRECT_URI,
  };
}

function redditConfig(env: Env) {
  return {
    clientId: env.REDDIT_CLIENT_ID,
    clientSecret: env.REDDIT_CLIENT_SECRET,
    userAgent: env.REDDIT_USER_AGENT,
  };
}

/** Reply length ceiling: platform limit, tightened by the voice profile if it asks. */
function maxCharsFor(network: string, voiceMax: number | null, env: Env): number {
  const platform = network === "reddit" ? 10_000 : env.ENGAGE_MAX_REPLY_CHARS;
  return voiceMax && voiceMax > 0 ? Math.min(voiceMax, platform) : platform;
}

/** Run the deterministic checks with live duplicate/link history from the DB. */
async function runSafety(c: Context<HonoEnv>, body: string, maxChars: number) {
  const repo = c.get("repo");
  const [windowDays, linkMax, simWindow] = await Promise.all([
    repo.getSetting<number>("engage.link_reuse_window_days"),
    repo.getSetting<number>("engage.link_reuse_max"),
    repo.getSetting<number>("engage.similarity_window"),
  ]);
  const sinceIso = new Date(Date.now() - (windowDays ?? 7) * 86_400_000).toISOString();
  const [recentReplies, recentLinkHosts] = await Promise.all([
    repo.engage.recentSentBodies(simWindow ?? 50),
    repo.engage.recentLinkHosts(sinceIso),
  ]);
  return checkReply(body, { recentReplies, recentLinkHosts, linkReuseMax: linkMax ?? 3, maxChars });
}

/** Same Claude budget gate the screening pipeline uses (spec §30). */
async function assertClaudeBudget(c: Context<HonoEnv>): Promise<void> {
  const repo = c.get("repo");
  const env = c.get("env");
  const nowMs = Date.now();
  const dayIso = new Date(nowMs - (nowMs % 86_400_000)).toISOString();
  const monthIso = new Date(nowMs - 30 * 86_400_000).toISOString();
  const [xDailyUsed, xMonthlyUsed, claudeDailyRequests] = await Promise.all([
    repo.xResourcesSince(dayIso), repo.xResourcesSince(monthIso), repo.claudeRequestsSince(dayIso),
  ]);
  const decision = checkClaudeBudget(
    { xDailyUsed, xMonthlyUsed, claudeDailyRequests },
    {
      xDailyResourceBudget: env.X_DAILY_RESOURCE_BUDGET,
      xMonthlyResourceBudget: env.X_MONTHLY_RESOURCE_BUDGET,
      claudeDailyRequestBudget: env.CLAUDE_DAILY_REQUEST_BUDGET,
      hardStop: env.HARD_STOP_ON_BUDGET_EXCEEDED,
    },
  );
  if (!decision.allowed) {
    throw new AppError("BUDGET_EXCEEDED", "Daily Claude request budget reached");
  }
}

/**
 * Decrypt the stored access token, refreshing it first if it is expired or close to it.
 * The refreshed pair is re-encrypted and persisted so the next call is cheap.
 */
async function userAccessToken(c: Context<HonoEnv>): Promise<string> {
  const env = c.get("env");
  const repo = c.get("repo");
  if (!capabilities(env).xWriteConfigured) {
    throw new AppError("CONFIGURATION_ERROR", "X OAuth is not configured — cannot send replies");
  }
  const row = await repo.engage.getOAuthToken(X_ACCOUNT_KEY);
  if (!row) throw new AppError("AUTHENTICATION_ERROR", "No X account connected");

  const key = await importEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
  const nowMs = Date.now();

  if (!isExpired(row.expiresAt, nowMs)) {
    return decryptSecret(key, row.accessTokenEnc);
  }
  if (!row.refreshTokenEnc) {
    throw new AppError("AUTHENTICATION_ERROR", "X access token expired and no refresh token is stored — reconnect the account");
  }

  const refreshed = await refreshAccessToken(
    oauthConfig(env),
    await decryptSecret(key, row.refreshTokenEnc),
    globalFetch,
    nowMs,
  );
  await repo.engage.saveOAuthToken({
    accountKey: X_ACCOUNT_KEY, network: "x", externalUserId: row.externalUserId, username: row.username,
    accessTokenEnc: await encryptSecret(key, refreshed.accessToken),
    refreshTokenEnc: refreshed.refreshToken ? await encryptSecret(key, refreshed.refreshToken) : null,
    scope: refreshed.scope ?? row.scope, expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

function topN(table: Record<string, number>, n: number): { key: string; net: number }[] {
  return Object.entries(table)
    .map(([key, net]) => ({ key, net }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.key.localeCompare(b.key))
    .slice(0, n);
}
