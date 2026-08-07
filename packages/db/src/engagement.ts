import type {
  Campaign,
  EngagementEvent,
  EngagementEventKind,
  EngagementSession,
  EngagementSignals,
  Network,
  ReplyDraft,
  SentReply,
  VoiceProfile,
} from "@xie/shared";
import { type D1Like, type Clock, type IdGen, systemClock, randomIdGen } from "./d1.js";
import {
  rowToCampaign,
  rowToEngagementEvent,
  rowToEngagementSession,
  rowToOAuthToken,
  rowToReplyDraft,
  rowToSentReply,
  rowToVoiceProfile,
  type OAuthTokenRow,
} from "./rows.js";

/**
 * Repository for the engagement layer (spec §63): campaigns, voice profiles, reply
 * drafts, sends, session/goal tracking, and OAuth token storage. ALL SQL lives here.
 *
 * Idempotency is enforced the same way as the rest of the pipeline: UNIQUE constraints
 * plus INSERT … ON CONFLICT, so a replayed request can never double-post or double-count.
 */
export class EngagementRepo {
  constructor(
    private readonly db: D1Like,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdGen = randomIdGen(),
  ) {}

  // ── Voice profiles ─────────────────────────────────────────────────────────
  async listVoiceProfiles(): Promise<VoiceProfile[]> {
    const { results } = await this.db.prepare("SELECT * FROM voice_profiles ORDER BY name").all();
    return results.map(rowToVoiceProfile);
  }

  async getVoiceProfile(id: string): Promise<VoiceProfile | null> {
    const r = await this.db.prepare("SELECT * FROM voice_profiles WHERE id=?").bind(id).first();
    return r ? rowToVoiceProfile(r) : null;
  }

  async createVoiceProfile(v: Partial<VoiceProfile> & { name: string }): Promise<string> {
    const id = this.ids.next("voice");
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `INSERT INTO voice_profiles (id,name,tone,audience,perspective,do_json,dont_json,
           sample_replies_json,max_chars,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, v.name, v.tone ?? "direct, factual, collegial", v.audience ?? null, v.perspective ?? null,
        JSON.stringify(v.do ?? []), JSON.stringify(v.dont ?? []), JSON.stringify(v.sampleReplies ?? []),
        v.maxChars ?? 260, now, now,
      )
      .run();
    return id;
  }

  async updateVoiceProfile(id: string, v: Partial<VoiceProfile>): Promise<void> {
    const cur = await this.getVoiceProfile(id);
    if (!cur) return;
    const next = { ...cur, ...v };
    await this.db
      .prepare(
        `UPDATE voice_profiles SET name=?,tone=?,audience=?,perspective=?,do_json=?,dont_json=?,
           sample_replies_json=?,max_chars=?,updated_at=? WHERE id=?`,
      )
      .bind(
        next.name, next.tone, next.audience, next.perspective, JSON.stringify(next.do),
        JSON.stringify(next.dont), JSON.stringify(next.sampleReplies), next.maxChars,
        this.clock.nowIso(), id,
      )
      .run();
  }

  async deleteVoiceProfile(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM voice_profiles WHERE id=?").bind(id).run();
  }

  // ── Campaigns ──────────────────────────────────────────────────────────────
  async listCampaigns(): Promise<(Campaign & { monitorCount: number })[]> {
    const { results } = await this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM campaign_monitors m WHERE m.campaign_id = c.id) AS monitor_count
         FROM campaigns c ORDER BY c.name`,
      )
      .all();
    return results.map((r) => ({
      ...rowToCampaign(r),
      monitorCount: Number((r as { monitor_count?: number }).monitor_count ?? 0),
    }));
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const r = await this.db.prepare("SELECT * FROM campaigns WHERE id=?").bind(id).first();
    return r ? rowToCampaign(r) : null;
  }

  async createCampaign(c: Partial<Campaign> & { name: string; slug: string }): Promise<string> {
    const id = this.ids.next("camp");
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `INSERT INTO campaigns (id,name,slug,description,enabled,networks_json,goal_replies_per_day,
           voice_profile_id,strategy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, c.name, c.slug, c.description ?? null, c.enabled === false ? 0 : 1,
        JSON.stringify(c.networks ?? ["x"]), c.goalRepliesPerDay ?? 10,
        c.voiceProfileId ?? null, c.strategy ?? null, now, now,
      )
      .run();
    return id;
  }

  async updateCampaign(id: string, patch: Partial<Campaign>): Promise<void> {
    const cur = await this.getCampaign(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    await this.db
      .prepare(
        `UPDATE campaigns SET name=?,description=?,enabled=?,networks_json=?,goal_replies_per_day=?,
           voice_profile_id=?,strategy=?,updated_at=? WHERE id=?`,
      )
      .bind(
        next.name, next.description, next.enabled ? 1 : 0, JSON.stringify(next.networks),
        next.goalRepliesPerDay, next.voiceProfileId, next.strategy, this.clock.nowIso(), id,
      )
      .run();
  }

  async deleteCampaign(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM campaigns WHERE id=?").bind(id).run();
  }

  /**
   * Remove a network from a campaign without deleting the campaign: the network is
   * dropped from `networks_json` and its monitors are unlinked. Monitors themselves
   * survive — they may belong to other campaigns.
   */
  async detachNetwork(campaignId: string, network: Network): Promise<number> {
    const c = await this.getCampaign(campaignId);
    if (!c) return 0;
    const res = await this.db
      .prepare(
        `DELETE FROM campaign_monitors WHERE campaign_id=? AND monitor_id IN
           (SELECT id FROM monitors WHERE network=?)`,
      )
      .bind(campaignId, network)
      .run();
    await this.db
      .prepare("UPDATE campaigns SET networks_json=?, updated_at=? WHERE id=?")
      .bind(JSON.stringify(c.networks.filter((n) => n !== network)), this.clock.nowIso(), campaignId)
      .run();
    return res.meta?.changes ?? 0;
  }

  async linkMonitor(campaignId: string, monitorId: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO campaign_monitors (campaign_id,monitor_id,created_at) VALUES (?,?,?)
         ON CONFLICT (campaign_id, monitor_id) DO NOTHING`,
      )
      .bind(campaignId, monitorId, this.clock.nowIso())
      .run();
  }

  async unlinkMonitor(campaignId: string, monitorId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM campaign_monitors WHERE campaign_id=? AND monitor_id=?")
      .bind(campaignId, monitorId)
      .run();
  }

  async campaignMonitorIds(campaignId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT monitor_id FROM campaign_monitors WHERE campaign_id=?")
      .bind(campaignId)
      .all<{ monitor_id: string }>();
    return results.map((r) => String(r.monitor_id));
  }

  // ── Engage queue ───────────────────────────────────────────────────────────
  /**
   * Candidate posts for triage: screened at/above the threshold, not archived or
   * dismissed, not already replied to. Ordering is applied in the ranker — this only
   * bounds the candidate set (most recent first) so the query stays cheap on D1.
   */
  async engageCandidates(opts: {
    campaignId?: string | null;
    network?: Network | null;
    minStrategic?: number;
    sinceIso?: string;
    limit?: number;
  }): Promise<
    {
      postId: string; network: Network; xPostId: string; authorUsername: string | null;
      authorName: string | null; text: string; url: string | null; createdAt: string;
      likeCount: number; replyCount: number; topic: string | null; strategicScore: number | null;
      relevanceScore: number | null; summary: string | null; draftCount: number;
      hasReply: number; monitorNames: string | null;
    }[]
  > {
    const where: string[] = [
      "COALESCE(st.is_archived,0) = 0",
      "COALESCE(st.is_dismissed,0) = 0",
    ];
    const binds: unknown[] = [];

    if (opts.campaignId) {
      where.push(
        `p.id IN (SELECT pmm.post_id FROM post_monitor_matches pmm
                    JOIN campaign_monitors cm ON cm.monitor_id = pmm.monitor_id
                  WHERE cm.campaign_id = ?)`,
      );
      binds.push(opts.campaignId);
    }
    if (opts.network) {
      where.push("p.network = ?");
      binds.push(opts.network);
    }
    if (opts.sinceIso) {
      where.push("p.created_at >= ?");
      binds.push(opts.sinceIso);
    }
    const minStrategic = opts.minStrategic ?? 0;
    if (minStrategic > 0) {
      where.push("COALESCE(s.strategic_importance_score, s.relevance_score, 0) >= ?");
      binds.push(minStrategic);
    }
    binds.push(Math.max(1, Math.min(200, opts.limit ?? 50)));

    const { results } = await this.db
      .prepare(
        `SELECT p.id AS post_id, p.network, p.x_post_id, p.author_username, p.author_name, p.text,
                p.url, p.created_at, p.like_count, p.reply_count,
                s.topic, s.strategic_importance_score, s.relevance_score, s.summary,
                (SELECT COUNT(*) FROM reply_drafts d WHERE d.post_id = p.id AND d.status='draft') AS draft_count,
                (SELECT COUNT(*) FROM sent_replies sr WHERE sr.post_id = p.id) AS has_reply,
                (SELECT GROUP_CONCAT(m.name, ', ') FROM post_monitor_matches pm
                   JOIN monitors m ON m.id = pm.monitor_id WHERE pm.post_id = p.id) AS monitor_names
         FROM posts p
           LEFT JOIN screening_results s ON s.post_id = p.id
           LEFT JOIN post_states st ON st.post_id = p.id
         WHERE ${where.join(" AND ")}
         ORDER BY p.created_at DESC
         LIMIT ?`,
      )
      .bind(...binds)
      .all<Record<string, unknown>>();

    return results.map((r) => ({
      postId: String(r.post_id),
      network: r.network === "reddit" ? "reddit" : "x",
      xPostId: String(r.x_post_id ?? ""),
      authorUsername: r.author_username == null ? null : String(r.author_username),
      authorName: r.author_name == null ? null : String(r.author_name),
      text: String(r.text ?? ""),
      url: r.url == null ? null : String(r.url),
      createdAt: String(r.created_at ?? ""),
      likeCount: Number(r.like_count ?? 0),
      replyCount: Number(r.reply_count ?? 0),
      topic: r.topic == null ? null : String(r.topic),
      strategicScore: r.strategic_importance_score == null ? null : Number(r.strategic_importance_score),
      relevanceScore: r.relevance_score == null ? null : Number(r.relevance_score),
      summary: r.summary == null ? null : String(r.summary),
      draftCount: Number(r.draft_count ?? 0),
      hasReply: Number(r.has_reply ?? 0),
      monitorNames: r.monitor_names == null ? null : String(r.monitor_names),
    }));
  }

  // ── Reply drafts ───────────────────────────────────────────────────────────
  async createDraft(d: {
    postId: string; campaignId: string | null; voiceProfileId: string | null; body: string;
    source?: ReplyDraft["source"]; model?: string | null; promptVersion?: string | null;
    inputTokens?: number | null; outputTokens?: number | null; estimatedCostUsd?: number;
  }): Promise<string> {
    const id = this.ids.next("draft");
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `INSERT INTO reply_drafts (id,post_id,campaign_id,voice_profile_id,body,status,source,model,
           prompt_version,input_tokens,output_tokens,estimated_cost_usd,created_at,updated_at)
         VALUES (?,?,?,?,?, 'draft', ?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, d.postId, d.campaignId, d.voiceProfileId, d.body, d.source ?? "ai", d.model ?? null,
        d.promptVersion ?? null, d.inputTokens ?? null, d.outputTokens ?? null,
        d.estimatedCostUsd ?? 0, now, now,
      )
      .run();
    return id;
  }

  async getDraft(id: string): Promise<ReplyDraft | null> {
    const r = await this.db.prepare("SELECT * FROM reply_drafts WHERE id=?").bind(id).first();
    return r ? rowToReplyDraft(r) : null;
  }

  async listDraftsForPost(postId: string): Promise<ReplyDraft[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM reply_drafts WHERE post_id=? ORDER BY created_at DESC")
      .bind(postId)
      .all();
    return results.map(rowToReplyDraft);
  }

  async updateDraftBody(id: string, body: string): Promise<void> {
    await this.db
      .prepare("UPDATE reply_drafts SET body=?, updated_at=? WHERE id=? AND status='draft'")
      .bind(body, this.clock.nowIso(), id)
      .run();
  }

  async setDraftStatus(id: string, status: ReplyDraft["status"]): Promise<void> {
    await this.db
      .prepare("UPDATE reply_drafts SET status=?, updated_at=? WHERE id=?")
      .bind(status, this.clock.nowIso(), id)
      .run();
  }

  // ── Sends ──────────────────────────────────────────────────────────────────
  /**
   * Claim the right to send exactly once. Returns null if this idempotency key was
   * already claimed — the caller must then NOT hit the X API (spec §2.4).
   */
  async claimSend(key: string, s: {
    draftId: string | null; postId: string; campaignId: string | null; network: Network; body: string;
  }): Promise<string | null> {
    const id = this.ids.next("sent");
    const res = await this.db
      .prepare(
        `INSERT INTO sent_replies (id,draft_id,post_id,campaign_id,network,body,idempotency_key,sent_at)
         VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(id, s.draftId, s.postId, s.campaignId, s.network, s.body, key, this.clock.nowIso())
      .run();
    return (res.meta?.changes ?? 0) > 0 ? id : null;
  }

  async recordSendResult(id: string, externalReplyId: string): Promise<void> {
    await this.db
      .prepare("UPDATE sent_replies SET external_reply_id=?, sent_at=? WHERE id=?")
      .bind(externalReplyId, this.clock.nowIso(), id)
      .run();
  }

  /** Roll back a claim when the upstream send failed, so the analyst can retry. */
  async releaseSend(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM sent_replies WHERE id=? AND external_reply_id IS NULL").bind(id).run();
  }

  async getSentReplyByKey(key: string): Promise<SentReply | null> {
    const r = await this.db.prepare("SELECT * FROM sent_replies WHERE idempotency_key=?").bind(key).first();
    return r ? rowToSentReply(r) : null;
  }

  /** Bodies of recently sent replies, newest first — input to the duplicate check. */
  async recentSentBodies(limit = 50): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT body FROM sent_replies ORDER BY sent_at DESC LIMIT ?")
      .bind(Math.max(1, Math.min(500, limit)))
      .all<{ body: string }>();
    return results.map((r) => String(r.body));
  }

  async listSentReplies(limit = 50): Promise<SentReply[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM sent_replies ORDER BY sent_at DESC LIMIT ?")
      .bind(Math.max(1, Math.min(200, limit)))
      .all();
    return results.map(rowToSentReply);
  }

  async sentCountSince(iso: string): Promise<number> {
    const r = await this.db
      .prepare("SELECT COUNT(*) AS n FROM sent_replies WHERE sent_at >= ?")
      .bind(iso)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  // ── Sessions ───────────────────────────────────────────────────────────────
  async startSession(campaignId: string | null, goal: number): Promise<string> {
    const id = this.ids.next("sess");
    await this.db
      .prepare("INSERT INTO engagement_sessions (id,campaign_id,goal,started_at) VALUES (?,?,?,?)")
      .bind(id, campaignId, goal, this.clock.nowIso())
      .run();
    return id;
  }

  async getSession(id: string): Promise<EngagementSession | null> {
    const r = await this.db.prepare("SELECT * FROM engagement_sessions WHERE id=?").bind(id).first();
    return r ? rowToEngagementSession(r) : null;
  }

  /** Close a session and freeze its counters from the recorded events. */
  async endSession(id: string): Promise<EngagementSession | null> {
    const s = await this.getSession(id);
    if (!s || s.endedAt) return s;
    const now = this.clock.nowIso();
    const seconds = Math.max(0, Math.round((Date.parse(now) - Date.parse(s.startedAt)) / 1000));
    await this.db
      .prepare(
        `UPDATE engagement_sessions SET ended_at=?, duration_seconds=?,
           reviewed  = (SELECT COUNT(DISTINCT post_id) FROM engagement_events WHERE session_id=?),
           replies_sent = (SELECT COUNT(*) FROM engagement_events WHERE session_id=? AND kind='replied'),
           skipped   = (SELECT COUNT(*) FROM engagement_events WHERE session_id=? AND kind='skipped'),
           follows   = (SELECT COUNT(*) FROM engagement_events WHERE session_id=? AND kind='followed')
         WHERE id=?`,
      )
      .bind(now, seconds, id, id, id, id, id)
      .run();
    return this.getSession(id);
  }

  async listSessions(limit = 30): Promise<EngagementSession[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM engagement_sessions ORDER BY started_at DESC LIMIT ?")
      .bind(Math.max(1, Math.min(200, limit)))
      .all();
    return results.map(rowToEngagementSession);
  }

  /** Live counters for an in-progress session (the closed-session columns are frozen). */
  async sessionLiveStats(id: string): Promise<{ reviewed: number; replied: number; skipped: number; followed: number; drafted: number }> {
    const { results } = await this.db
      .prepare("SELECT kind, COUNT(*) AS n FROM engagement_events WHERE session_id=? GROUP BY kind")
      .bind(id)
      .all<{ kind: string; n: number }>();
    const by = new Map(results.map((r) => [String(r.kind), Number(r.n)]));
    const reviewed = await this.db
      .prepare("SELECT COUNT(DISTINCT post_id) AS n FROM engagement_events WHERE session_id=?")
      .bind(id)
      .first<{ n: number }>();
    return {
      reviewed: reviewed?.n ?? 0,
      replied: by.get("replied") ?? 0,
      skipped: by.get("skipped") ?? 0,
      followed: by.get("followed") ?? 0,
      drafted: by.get("drafted") ?? 0,
    };
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  /** Idempotent per (session, post, kind) — a replayed click can't double-count. */
  async recordEvent(e: {
    sessionId: string | null; campaignId: string | null; postId: string;
    kind: EngagementEventKind; metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO engagement_events (id,session_id,campaign_id,post_id,kind,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?) ON CONFLICT (session_id, post_id, kind) DO NOTHING`,
      )
      .bind(
        this.ids.next("ev"), e.sessionId, e.campaignId, e.postId, e.kind,
        e.metadata ? JSON.stringify(e.metadata) : null, this.clock.nowIso(),
      )
      .run();
  }

  async listEvents(limit = 100): Promise<EngagementEvent[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM engagement_events ORDER BY created_at DESC LIMIT ?")
      .bind(Math.max(1, Math.min(500, limit)))
      .all();
    return results.map(rowToEngagementEvent);
  }

  /**
   * Learned triage signal: per-author and per-topic net engagement. "engaged" and
   * "replied" count +1; "skipped" counts -1. This is the entire learning mechanism —
   * counting, not a model — so queue ordering stays explainable and reproducible.
   */
  async engagementSignals(campaignId?: string | null): Promise<EngagementSignals> {
    const filter = campaignId ? "AND e.campaign_id = ?" : "";
    const binds = campaignId ? [campaignId] : [];

    const { results } = await this.db
      .prepare(
        `SELECT LOWER(COALESCE(p.author_username,'')) AS author,
                LOWER(COALESCE(s.topic,'')) AS topic,
                e.kind, COUNT(*) AS n
         FROM engagement_events e
           JOIN posts p ON p.id = e.post_id
           LEFT JOIN screening_results s ON s.post_id = p.id
         WHERE e.kind IN ('engaged','replied','skipped') ${filter}
         GROUP BY author, topic, e.kind`,
      )
      .bind(...binds)
      .all<{ author: string; topic: string; kind: string; n: number }>();

    const authorAffinity: Record<string, number> = {};
    const topicAffinity: Record<string, number> = {};
    let totalEngaged = 0;
    let totalSkipped = 0;

    for (const r of results) {
      const n = Number(r.n ?? 0);
      const delta = r.kind === "skipped" ? -n : n;
      if (r.kind === "skipped") totalSkipped += n;
      else totalEngaged += n;
      const author = String(r.author ?? "");
      const topic = String(r.topic ?? "");
      if (author) authorAffinity[author] = (authorAffinity[author] ?? 0) + delta;
      if (topic) topicAffinity[topic] = (topicAffinity[topic] ?? 0) + delta;
    }

    return { authorAffinity, topicAffinity, totalEngaged, totalSkipped };
  }

  /** Link hosts used in sent replies within the window, host → count. */
  async recentLinkHosts(sinceIso: string): Promise<Record<string, number>> {
    const { results } = await this.db
      .prepare("SELECT body FROM sent_replies WHERE sent_at >= ?")
      .bind(sinceIso)
      .all<{ body: string }>();
    const hosts: Record<string, number> = {};
    for (const r of results) {
      for (const url of String(r.body).match(/https?:\/\/[^\s<>"')]+/gi) ?? []) {
        const host = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0]?.toLowerCase();
        if (host) hosts[host] = (hosts[host] ?? 0) + 1;
      }
    }
    return hosts;
  }

  // ── OAuth token storage (ciphertext only) ──────────────────────────────────
  async saveOAuthToken(t: {
    accountKey: string; network: Network; externalUserId: string | null; username: string | null;
    accessTokenEnc: string; refreshTokenEnc: string | null; scope: string | null; expiresAt: string | null;
  }): Promise<void> {
    const now = this.clock.nowIso();
    await this.db
      .prepare(
        `INSERT INTO oauth_tokens (id,account_key,network,external_user_id,username,access_token_enc,
           refresh_token_enc,scope,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (account_key) DO UPDATE SET
           network=excluded.network, external_user_id=excluded.external_user_id,
           username=excluded.username, access_token_enc=excluded.access_token_enc,
           refresh_token_enc=COALESCE(excluded.refresh_token_enc, oauth_tokens.refresh_token_enc),
           scope=excluded.scope, expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
      )
      .bind(
        this.ids.next("oauth"), t.accountKey, t.network, t.externalUserId, t.username,
        t.accessTokenEnc, t.refreshTokenEnc, t.scope, t.expiresAt, now, now,
      )
      .run();
  }

  async getOAuthToken(accountKey: string): Promise<OAuthTokenRow | null> {
    const r = await this.db.prepare("SELECT * FROM oauth_tokens WHERE account_key=?").bind(accountKey).first();
    return r ? rowToOAuthToken(r) : null;
  }

  async deleteOAuthToken(accountKey: string): Promise<void> {
    await this.db.prepare("DELETE FROM oauth_tokens WHERE account_key=?").bind(accountKey).run();
  }

  // ── PKCE handshake state ───────────────────────────────────────────────────
  async saveOAuthState(state: string, codeVerifier: string, redirectUri: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO oauth_states (state,code_verifier,redirect_uri,created_at) VALUES (?,?,?,?)")
      .bind(state, codeVerifier, redirectUri, this.clock.nowIso())
      .run();
  }

  /** Single-use: the row is deleted whether or not it is still within its TTL. */
  async consumeOAuthState(state: string, maxAgeSeconds = 600): Promise<{ codeVerifier: string; redirectUri: string } | null> {
    const r = await this.db
      .prepare("SELECT code_verifier, redirect_uri, created_at FROM oauth_states WHERE state=?")
      .bind(state)
      .first<{ code_verifier: string; redirect_uri: string; created_at: string }>();
    await this.db.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();
    if (!r) return null;
    const age = (Date.parse(this.clock.nowIso()) - Date.parse(String(r.created_at))) / 1000;
    if (!Number.isFinite(age) || age > maxAgeSeconds) return null;
    return { codeVerifier: String(r.code_verifier), redirectUri: String(r.redirect_uri) };
  }

  async purgeExpiredOAuthStates(maxAgeSeconds = 600): Promise<number> {
    const cutoff = new Date(Date.parse(this.clock.nowIso()) - maxAgeSeconds * 1000).toISOString();
    const res = await this.db.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(cutoff).run();
    return res.meta?.changes ?? 0;
  }
}
