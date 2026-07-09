import type {
  Monitor,
  NormalizedXPost,
  PrefilterResult,
  ScreeningRecord,
  ScreeningResult,
  Alert,
  AlertSeverity,
  Digest,
  IngestionRun,
  IngestionRunStatus,
  PostState,
  Watchlist,
  WatchlistAccount,
  CursorPage,
} from "@xie/shared";
import { isMonitorDue } from "@xie/config";
import { type D1Like, type Clock, type IdGen, systemClock, randomIdGen } from "./d1.js";
import {
  rowToMonitor,
  rowToPost,
  rowToScreening,
  rowToState,
  rowToAlert,
  rowToDigest,
  rowToRun,
  rowToWatchlist,
  rowToWatchlistAccount,
  type PostRow,
} from "./rows.js";

/**
 * Typed repository layer over D1 (spec §9). ALL SQL lives here — never in routes/UI.
 * Idempotency (spec §2.4) is enforced with UNIQUE constraints + INSERT ... ON CONFLICT.
 */
export class Repositories {
  constructor(
    private readonly db: D1Like,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdGen = randomIdGen(),
  ) {}

  // ── Monitors ──────────────────────────────────────────────────────────────
  async listMonitors(): Promise<Monitor[]> {
    const { results } = await this.db.prepare("SELECT * FROM monitors ORDER BY priority DESC, name").all();
    return results.map(rowToMonitor);
  }

  async getMonitor(id: string): Promise<Monitor | null> {
    const r = await this.db.prepare("SELECT * FROM monitors WHERE id = ?").bind(id).first();
    return r ? rowToMonitor(r) : null;
  }

  async dueMonitors(nowMs: number): Promise<Monitor[]> {
    const all = await this.listMonitors();
    return all.filter((m) =>
      isMonitorDue(
        { enabled: m.enabled, pollIntervalMinutes: m.pollIntervalMinutes, lastRunAt: m.lastRunAt },
        nowMs,
      ),
    );
  }

  async setMonitorRunResult(
    id: string,
    patch: { lastRunAt: string; lastSuccessAt?: string | null; lastError?: string | null; sinceId?: string | null },
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE monitors SET last_run_at = ?, last_success_at = COALESCE(?, last_success_at),
         last_error = ?, since_id = COALESCE(?, since_id), updated_at = ? WHERE id = ?`,
      )
      .bind(patch.lastRunAt, patch.lastSuccessAt ?? null, patch.lastError ?? null, patch.sinceId ?? null, this.clock.nowIso(), id)
      .run();
  }

  async createMonitor(m: Partial<Monitor> & { name: string; slug: string; type: Monitor["type"] }): Promise<string> {
    const now = this.clock.nowIso();
    const id = m.id ?? this.ids.next("mon");
    await this.db
      .prepare(
        `INSERT INTO monitors (id,name,slug,description,type,enabled,priority,x_query,x_list_id,
          poll_interval_minutes,max_results_per_run,max_pages_per_run,prefilter_threshold,
          ai_screening_threshold,alert_threshold,language,excluded_terms_json,required_terms_json,
          created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, m.name, m.slug, m.description ?? null, m.type, m.enabled ? 1 : 0, m.priority ?? 50,
        m.xQuery ?? null, m.xListId ?? null, m.pollIntervalMinutes ?? 60, m.maxResultsPerRun ?? 25,
        m.maxPagesPerRun ?? 1, m.prefilterThreshold ?? 40, m.aiScreeningThreshold ?? 40,
        m.alertThreshold ?? 90, m.language ?? null, JSON.stringify(m.excludedTerms ?? []),
        JSON.stringify(m.requiredTerms ?? []), now, now,
      )
      .run();
    return id;
  }

  async setMonitorEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.prepare("UPDATE monitors SET enabled = ?, updated_at = ? WHERE id = ?")
      .bind(enabled ? 1 : 0, this.clock.nowIso(), id).run();
  }

  async deleteMonitor(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM monitors WHERE id = ?").bind(id).run();
  }

  // ── Posts (idempotent upsert on x_post_id) ─────────────────────────────────
  async upsertPost(post: NormalizedXPost): Promise<{ id: string; isNew: boolean }> {
    const existing = await this.db
      .prepare("SELECT id FROM posts WHERE x_post_id = ?")
      .bind(post.xPostId)
      .first<{ id: string }>();
    const now = this.clock.nowIso();
    if (existing) {
      // Update mutable public metrics; preserve first_seen_at (spec §12C, §55).
      await this.db
        .prepare(
          `UPDATE posts SET like_count=?, repost_count=?, reply_count=?, quote_count=?,
             bookmark_count=?, impression_count=?, author_username=COALESCE(?,author_username),
             author_name=COALESCE(?,author_name), url=COALESCE(?,url), last_seen_at=?, updated_at=?
           WHERE x_post_id=?`,
        )
        .bind(
          post.metrics.likeCount, post.metrics.repostCount, post.metrics.replyCount,
          post.metrics.quoteCount, post.metrics.bookmarkCount, post.metrics.impressionCount,
          post.authorUsername, post.authorName, post.url, now, now, post.xPostId,
        )
        .run();
      return { id: existing.id, isNew: false };
    }
    const id = this.ids.next("post");
    await this.db
      .prepare(
        `INSERT INTO posts (id,x_post_id,author_id,author_username,author_name,text,lang,created_at,
           conversation_id,in_reply_to_user_id,url,like_count,repost_count,reply_count,quote_count,
           bookmark_count,impression_count,raw_json,first_seen_at,last_seen_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, post.xPostId, post.authorId || null, post.authorUsername, post.authorName, post.text,
        post.lang, post.createdAt || null, post.conversationId, post.inReplyToUserId, post.url,
        post.metrics.likeCount, post.metrics.repostCount, post.metrics.replyCount, post.metrics.quoteCount,
        post.metrics.bookmarkCount, post.metrics.impressionCount, JSON.stringify(post.raw ?? null), now, now, now,
      )
      .run();
    return { id, isNew: true };
  }

  async getPost(id: string): Promise<PostRow | null> {
    const r = await this.db.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
    return r ? rowToPost(r) : null;
  }

  async getPostByXId(xPostId: string): Promise<PostRow | null> {
    const r = await this.db.prepare("SELECT * FROM posts WHERE x_post_id = ?").bind(xPostId).first();
    return r ? rowToPost(r) : null;
  }

  // ── Monitor matches (idempotent) ───────────────────────────────────────────
  async recordMatch(postId: string, monitorId: string, matchedRule: string | null): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO post_monitor_matches (id,post_id,monitor_id,matched_rule,matched_at)
         VALUES (?,?,?,?,?) ON CONFLICT (post_id, monitor_id) DO NOTHING`,
      )
      .bind(this.ids.next("pmm"), postId, monitorId, matchedRule, this.clock.nowIso())
      .run();
  }

  async monitorMatchCount(postId: string): Promise<number> {
    const r = await this.db
      .prepare("SELECT COUNT(*) AS n FROM post_monitor_matches WHERE post_id = ?")
      .bind(postId)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  // ── Prefilter (idempotent per rules_version) ───────────────────────────────
  async savePrefilter(postId: string, r: PrefilterResult): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO prefilter_results (id,post_id,score,keyword_score,source_score,engagement_score,
           primary_source_score,penalty_score,decision,reasons_json,rules_version,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (post_id, rules_version) DO UPDATE SET
           score=excluded.score, keyword_score=excluded.keyword_score, source_score=excluded.source_score,
           engagement_score=excluded.engagement_score, primary_source_score=excluded.primary_source_score,
           penalty_score=excluded.penalty_score, decision=excluded.decision, reasons_json=excluded.reasons_json`,
      )
      .bind(
        this.ids.next("pf"), postId, r.score, r.keywordScore, r.sourceScore, r.engagementScore,
        r.primarySourceScore, r.penaltyScore, r.decision, JSON.stringify(r.reasons), r.rulesVersion,
        this.clock.nowIso(),
      )
      .run();
  }

  // ── Screening (idempotent per post+model+prompt_version) ───────────────────
  async isAlreadyScreened(postId: string, model: string, promptVersion: string): Promise<boolean> {
    const r = await this.db
      .prepare("SELECT 1 AS x FROM screening_results WHERE post_id=? AND model=? AND prompt_version=?")
      .bind(postId, model, promptVersion)
      .first();
    return r != null;
  }

  async saveScreening(
    postId: string,
    provider: string,
    model: string,
    promptVersion: string,
    result: ScreeningResult,
    usage: { inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null },
    raw: unknown,
  ): Promise<void> {
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `INSERT INTO screening_results (id,post_id,provider,model,prompt_version,relevance_score,
           novelty_score,credibility_score,strategic_importance_score,topic,subtopic,requires_followup,
           reason,summary,recommended_action,entities_json,risks_json,evidence_json,raw_response_json,
           input_tokens,output_tokens,estimated_cost_usd,scored_at,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (post_id, model, prompt_version) DO UPDATE SET
           relevance_score=excluded.relevance_score, novelty_score=excluded.novelty_score,
           credibility_score=excluded.credibility_score,
           strategic_importance_score=excluded.strategic_importance_score,
           topic=excluded.topic, subtopic=excluded.subtopic, requires_followup=excluded.requires_followup,
           reason=excluded.reason, summary=excluded.summary, recommended_action=excluded.recommended_action,
           entities_json=excluded.entities_json, risks_json=excluded.risks_json,
           evidence_json=excluded.evidence_json, scored_at=excluded.scored_at`,
      )
      .bind(
        this.ids.next("scr"), postId, provider, model, promptVersion, result.relevanceScore,
        result.noveltyScore, result.credibilityScore, result.strategicImportanceScore, result.topic,
        result.subtopic, result.requiresFollowup ? 1 : 0, result.reason, result.summary,
        result.recommendedAction, JSON.stringify(result.entities), JSON.stringify(result.risks),
        JSON.stringify(result.evidence), JSON.stringify(raw ?? null), usage.inputTokens, usage.outputTokens,
        usage.estimatedCostUsd, now, now,
      )
      .run();
  }

  async latestScreening(postId: string): Promise<ScreeningRecord | null> {
    const r = await this.db
      .prepare("SELECT * FROM screening_results WHERE post_id=? ORDER BY scored_at DESC LIMIT 1")
      .bind(postId)
      .first();
    return r ? rowToScreening(r) : null;
  }

  // ── Post state ─────────────────────────────────────────────────────────────
  async getState(postId: string): Promise<PostState | null> {
    const r = await this.db.prepare("SELECT * FROM post_states WHERE post_id=?").bind(postId).first();
    return r ? rowToState(r) : null;
  }

  async patchState(postId: string, patch: Partial<Omit<PostState, "postId" | "updatedAt">>): Promise<void> {
    const now = this.clock.nowIso();
    const cur = (await this.getState(postId)) ?? {
      postId, isRead: false, isStarred: false, isArchived: false, isDismissed: false, notes: null, updatedAt: now,
    };
    const next = { ...cur, ...patch };
    await this.db
      .prepare(
        `INSERT INTO post_states (post_id,is_read,is_starred,is_archived,is_dismissed,notes,updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (post_id) DO UPDATE SET is_read=excluded.is_read, is_starred=excluded.is_starred,
           is_archived=excluded.is_archived, is_dismissed=excluded.is_dismissed, notes=excluded.notes,
           updated_at=excluded.updated_at`,
      )
      .bind(postId, next.isRead ? 1 : 0, next.isStarred ? 1 : 0, next.isArchived ? 1 : 0,
        next.isDismissed ? 1 : 0, next.notes ?? null, now)
      .run();
  }

  // ── Alerts (idempotent per post+monitor) ───────────────────────────────────
  async createAlert(a: {
    postId: string; monitorId: string | null; severity: AlertSeverity; title: string; reason: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO alerts (id,post_id,monitor_id,severity,title,reason,status,created_at)
         VALUES (?,?,?,?,?,?, 'open', ?)
         ON CONFLICT (post_id, monitor_id) DO NOTHING`,
      )
      .bind(this.ids.next("alr"), a.postId, a.monitorId, a.severity, a.title, a.reason, this.clock.nowIso())
      .run();
  }

  async listAlerts(status?: string): Promise<Alert[]> {
    const q = status
      ? this.db.prepare("SELECT * FROM alerts WHERE status=? ORDER BY created_at DESC").bind(status)
      : this.db.prepare("SELECT * FROM alerts ORDER BY created_at DESC");
    const { results } = await q.all();
    return results.map(rowToAlert);
  }

  async patchAlert(id: string, status: Alert["status"]): Promise<void> {
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `UPDATE alerts SET status=?, acknowledged_at=CASE WHEN ?='acknowledged' THEN ? ELSE acknowledged_at END,
           resolved_at=CASE WHEN ?='resolved' THEN ? ELSE resolved_at END WHERE id=?`,
      )
      .bind(status, status, now, status, now, id)
      .run();
  }

  /** Analyst-created standalone alert (no post/monitor). Requires migration 0004. */
  async createManualAlert(a: { severity: AlertSeverity; title: string; reason: string }): Promise<string> {
    const id = this.ids.next("alr");
    await this.db
      .prepare(
        `INSERT INTO alerts (id,post_id,monitor_id,severity,title,reason,status,created_at)
         VALUES (?, NULL, NULL, ?, ?, ?, 'open', ?)`,
      )
      .bind(id, a.severity, a.title, a.reason, this.clock.nowIso())
      .run();
    return id;
  }

  // ── Watchlists (spec §6.5) ──────────────────────────────────────────────────
  async listWatchlists(): Promise<(Watchlist & { accountCount: number })[]> {
    const { results } = await this.db
      .prepare(
        `SELECT w.*, (SELECT COUNT(*) FROM watchlist_accounts a WHERE a.watchlist_id = w.id) AS account_count
         FROM watchlists w ORDER BY w.name`,
      )
      .all();
    return results.map((r) => ({ ...rowToWatchlist(r), accountCount: Number((r as { account_count?: number }).account_count ?? 0) }));
  }

  async getWatchlist(id: string): Promise<Watchlist | null> {
    const r = await this.db.prepare("SELECT * FROM watchlists WHERE id=?").bind(id).first();
    return r ? rowToWatchlist(r) : null;
  }

  async createWatchlist(w: { name: string; slug: string; description?: string | null }): Promise<string> {
    const id = this.ids.next("wl");
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `INSERT INTO watchlists (id,name,slug,description,enabled,created_at,updated_at)
         VALUES (?,?,?,?,1,?,?)`,
      )
      .bind(id, w.name, w.slug, w.description ?? null, now, now)
      .run();
    return id;
  }

  async setWatchlistEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.prepare("UPDATE watchlists SET enabled=?, updated_at=? WHERE id=?")
      .bind(enabled ? 1 : 0, this.clock.nowIso(), id).run();
  }

  async deleteWatchlist(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM watchlists WHERE id=?").bind(id).run();
  }

  async listWatchlistAccounts(watchlistId: string): Promise<WatchlistAccount[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM watchlist_accounts WHERE watchlist_id=? ORDER BY priority DESC, username")
      .bind(watchlistId)
      .all();
    return results.map(rowToWatchlistAccount);
  }

  async addWatchlistAccount(
    watchlistId: string,
    a: { username: string; displayName?: string | null; priority?: number; tags?: string[]; notes?: string | null },
  ): Promise<string> {
    const id = this.ids.next("wla");
    const now = this.clock.nowIso();
    const username = a.username.replace(/^@/, "").trim();
    await this.db
      .prepare(
        `INSERT INTO watchlist_accounts (id,watchlist_id,username,display_name,priority,tags_json,notes,enabled,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,1,?,?)
         ON CONFLICT (watchlist_id, username) DO UPDATE SET
           display_name=excluded.display_name, priority=excluded.priority, tags_json=excluded.tags_json,
           notes=excluded.notes, updated_at=excluded.updated_at`,
      )
      .bind(id, watchlistId, username, a.displayName ?? null, a.priority ?? 50,
        JSON.stringify(a.tags ?? []), a.notes ?? null, now, now)
      .run();
    return id;
  }

  async removeWatchlistAccount(watchlistId: string, accountId: string): Promise<void> {
    await this.db.prepare("DELETE FROM watchlist_accounts WHERE id=? AND watchlist_id=?")
      .bind(accountId, watchlistId).run();
  }

  // ── Ingestion runs (idempotent per run_key) ────────────────────────────────
  async startRun(monitorId: string, runKey: string, status: IngestionRunStatus): Promise<string> {
    const id = this.ids.next("run");
    await this.db
      .prepare(
        `INSERT INTO ingestion_runs (id,monitor_id,run_key,status,started_at)
         VALUES (?,?,?,?,?) ON CONFLICT (run_key) DO NOTHING`,
      )
      .bind(id, monitorId, runKey, status, this.clock.nowIso())
      .run();
    const r = await this.db.prepare("SELECT id FROM ingestion_runs WHERE run_key=?").bind(runKey).first<{ id: string }>();
    return r?.id ?? id;
  }

  async finishRun(runKey: string, patch: Partial<IngestionRun> & { status: IngestionRunStatus }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE ingestion_runs SET status=?, completed_at=?, posts_requested=?, posts_received=?,
           posts_new=?, posts_duplicate=?, posts_enqueued=?, estimated_x_cost_usd=?, error=?
         WHERE run_key=?`,
      )
      .bind(
        patch.status, this.clock.nowIso(), patch.postsRequested ?? 0, patch.postsReceived ?? 0,
        patch.postsNew ?? 0, patch.postsDuplicate ?? 0, patch.postsEnqueued ?? 0,
        patch.estimatedXCostUsd ?? 0, patch.error ?? null, runKey,
      )
      .run();
  }

  async recentRuns(limit = 50): Promise<IngestionRun[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT ?")
      .bind(limit)
      .all();
    return results.map(rowToRun);
  }

  // ── API usage accounting (spec §33) ────────────────────────────────────────
  async recordUsage(u: {
    provider: "x" | "anthropic"; operation: string; monitorId: string | null; resourceCount?: number;
    requestCount?: number; inputTokens?: number | null; outputTokens?: number | null; estimatedCostUsd?: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO api_usage (id,provider,operation,monitor_id,resource_count,request_count,
           input_tokens,output_tokens,estimated_cost_usd,occurred_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.ids.next("use"), u.provider, u.operation, u.monitorId, u.resourceCount ?? 0,
        u.requestCount ?? 1, u.inputTokens ?? null, u.outputTokens ?? null, u.estimatedCostUsd ?? 0,
        this.clock.nowIso(),
      )
      .run();
  }

  async xResourcesSince(iso: string): Promise<number> {
    const r = await this.db
      .prepare("SELECT COALESCE(SUM(resource_count),0) AS n FROM api_usage WHERE provider='x' AND occurred_at >= ?")
      .bind(iso)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async claudeRequestsSince(iso: string): Promise<number> {
    const r = await this.db
      .prepare("SELECT COALESCE(SUM(request_count),0) AS n FROM api_usage WHERE provider='anthropic' AND occurred_at >= ?")
      .bind(iso)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  // ── Webhook dedup (idempotent per provider+hash) ───────────────────────────
  async recordWebhookEvent(provider: string, externalId: string | null, payloadHash: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `INSERT INTO webhook_events (id,provider,external_event_id,payload_hash,status,received_at)
         VALUES (?,?,?,?, 'received', ?) ON CONFLICT (provider, payload_hash) DO NOTHING`,
      )
      .bind(this.ids.next("wh"), provider, externalId, payloadHash, this.clock.nowIso())
      .run();
    return (res.meta?.changes ?? 0) > 0; // true => newly inserted (process it)
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async getSetting<T>(key: string): Promise<T | null> {
    const r = await this.db.prepare("SELECT value_json FROM app_settings WHERE key=?").bind(key).first<{ value_json: string }>();
    if (!r) return null;
    try {
      return JSON.parse(r.value_json) as T;
    } catch {
      return null;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO app_settings (key,value_json,is_secret_reference,updated_at) VALUES (?,?,0,?)
         ON CONFLICT (key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
      )
      .bind(key, JSON.stringify(value), this.clock.nowIso())
      .run();
  }

  // ── Digests ────────────────────────────────────────────────────────────────
  async createDigest(d: Omit<Digest, "id" | "createdAt" | "updatedAt">): Promise<string> {
    const id = this.ids.next("dig");
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `INSERT INTO digests (id,type,period_start,period_end,title,executive_summary,content_markdown,
           model,prompt_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(id, d.type, d.periodStart, d.periodEnd, d.title, d.executiveSummary, d.contentMarkdown,
        d.model, d.promptVersion, now, now)
      .run();
    return id;
  }

  async addDigestItem(digestId: string, postId: string, section: string, rank: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO digest_items (id,digest_id,post_id,section,rank,created_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT (digest_id, post_id) DO NOTHING`,
      )
      .bind(this.ids.next("di"), digestId, postId, section, rank, this.clock.nowIso())
      .run();
  }

  async listDigests(limit = 30): Promise<Digest[]> {
    const { results } = await this.db.prepare("SELECT * FROM digests ORDER BY period_start DESC LIMIT ?").bind(limit).all();
    return results.map(rowToDigest);
  }

  async getDigest(id: string): Promise<Digest | null> {
    const r = await this.db.prepare("SELECT * FROM digests WHERE id=?").bind(id).first();
    return r ? rowToDigest(r) : null;
  }

  /** Qualified posts for a digest window: screened at/above threshold, not dismissed. */
  async digestCandidates(startIso: string, endIso: string, minScore: number, limit = 40): Promise<
    { post: PostRow; screening: ScreeningRecord }[]
  > {
    const { results } = await this.db
      .prepare(
        `SELECT p.*, s.strategic_importance_score AS _sis FROM posts p
           JOIN screening_results s ON s.post_id = p.id
           LEFT JOIN post_states st ON st.post_id = p.id
         WHERE p.created_at >= ? AND p.created_at < ?
           AND s.strategic_importance_score >= ?
           AND COALESCE(st.is_dismissed,0) = 0
         ORDER BY s.strategic_importance_score DESC LIMIT ?`,
      )
      .bind(startIso, endIso, minScore, limit)
      .all();
    const out: { post: PostRow; screening: ScreeningRecord }[] = [];
    for (const row of results) {
      const post = rowToPost(row);
      const screening = await this.latestScreening(post.id);
      if (screening) out.push({ post, screening });
    }
    return out;
  }

  // ── Maintenance (spec §51) ───────────────────────────────────────────────
  private async countOf(table: string): Promise<number> {
    // `table` is never user-supplied — only the fixed whitelist below calls this.
    const r = await this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
    return r?.n ?? 0;
  }

  async maintenanceStats(): Promise<Record<string, number>> {
    const tables = [
      "posts", "screening_results", "prefilter_results", "post_monitor_matches",
      "alerts", "digests", "ingestion_runs", "api_usage", "jobs", "webhook_events", "monitors",
    ];
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = await this.countOf(t);
    return out;
  }

  async clearRuns(): Promise<number> {
    const r = await this.db.prepare("DELETE FROM ingestion_runs").run();
    return r.meta?.changes ?? 0;
  }

  async clearAlerts(): Promise<number> {
    const r = await this.db.prepare("DELETE FROM alerts").run();
    return r.meta?.changes ?? 0;
  }

  async clearUsage(): Promise<number> {
    const r = await this.db.prepare("DELETE FROM api_usage").run();
    return r.meta?.changes ?? 0;
  }

  async clearDigests(): Promise<number> {
    // digest_items cascade via FK ON DELETE CASCADE.
    const r = await this.db.prepare("DELETE FROM digests").run();
    return r.meta?.changes ?? 0;
  }

  /**
   * Delete all collected intelligence but PRESERVE configuration (monitors, watchlists,
   * settings). Deleting posts cascades matches/prefilter/screening/states/alerts/digest_items.
   * Optionally reset monitor checkpoints so they re-collect from scratch.
   */
  async resetIntelligence(opts: { resetCheckpoints?: boolean } = {}): Promise<Record<string, number>> {
    const before = await this.maintenanceStats();
    await this.db.prepare("DELETE FROM posts").run();
    await this.db.prepare("DELETE FROM digests").run();
    await this.db.prepare("DELETE FROM ingestion_runs").run();
    await this.db.prepare("DELETE FROM api_usage").run();
    await this.db.prepare("DELETE FROM jobs").run();
    await this.db.prepare("DELETE FROM webhook_events").run();
    if (opts.resetCheckpoints) {
      await this.db
        .prepare(
          `UPDATE monitors SET since_id=NULL, pagination_state_json=NULL, last_run_at=NULL,
             last_success_at=NULL, last_error=NULL, updated_at=?`,
        )
        .bind(this.clock.nowIso())
        .run();
    }
    return before;
  }

  /** Retention purge: delete posts older than cutoff, never touching starred posts (spec §51). */
  async purgeOldPosts(cutoffIso: string): Promise<number> {
    const r = await this.db
      .prepare(
        `DELETE FROM posts WHERE created_at < ?
           AND id NOT IN (SELECT post_id FROM post_states WHERE is_starred = 1)`,
      )
      .bind(cutoffIso)
      .run();
    return r.meta?.changes ?? 0;
  }

  async writeAudit(
    actor: string | null, action: string,
    entityType?: string | null, entityId?: string | null, metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_log (id,actor,action,entity_type,entity_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(this.ids.next("aud"), actor, action, entityType ?? null, entityId ?? null,
        metadata ? JSON.stringify(metadata) : null, this.clock.nowIso())
      .run();
  }
}

export type { CursorPage };
