import type {
  Monitor,
  NormalizedXPost,
  Alert,
  Campaign,
  Digest,
  EngagementEvent,
  EngagementSession,
  IngestionRun,
  Network,
  ReplyDraft,
  ScreeningRecord,
  PostState,
  SentReply,
  VoiceProfile,
  Watchlist,
  WatchlistAccount,
} from "@xie/shared";
import { bool, intOf, jsonParse } from "./d1.js";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
/** Columns added in 0007 are absent on rows read before the migration ran. */
const network = (v: unknown): Network => (v === "reddit" ? "reddit" : "x");

export function rowToMonitor(r: Row): Monitor {
  return {
    id: str(r.id),
    name: str(r.name),
    slug: str(r.slug),
    description: strOrNull(r.description),
    type: str(r.type) as Monitor["type"],
    network: network(r.network),
    subreddits: jsonParse<string[]>(r.subreddits_json, []),
    keywords: jsonParse<string[]>(r.keywords_json, []),
    enabled: bool(r.enabled),
    priority: intOf(r.priority, 50),
    xQuery: strOrNull(r.x_query),
    xListId: strOrNull(r.x_list_id),
    pollIntervalMinutes: intOf(r.poll_interval_minutes, 60),
    maxResultsPerRun: intOf(r.max_results_per_run, 25),
    maxPagesPerRun: intOf(r.max_pages_per_run, 1),
    prefilterThreshold: intOf(r.prefilter_threshold, 40),
    aiScreeningThreshold: intOf(r.ai_screening_threshold, 40),
    alertThreshold: intOf(r.alert_threshold, 90),
    language: strOrNull(r.language),
    excludedTerms: jsonParse<string[]>(r.excluded_terms_json, []),
    requiredTerms: jsonParse<string[]>(r.required_terms_json, []),
    schedule: jsonParse<Record<string, unknown> | null>(r.schedule_json, null),
    budget: jsonParse<Monitor["budget"]>(r.budget_json, null),
    sinceId: strOrNull(r.since_id),
    paginationState: jsonParse<Record<string, unknown> | null>(r.pagination_state_json, null),
    lastRunAt: strOrNull(r.last_run_at),
    lastSuccessAt: strOrNull(r.last_success_at),
    lastError: strOrNull(r.last_error),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export interface PostRow extends NormalizedXPost {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export function rowToPost(r: Row): PostRow {
  return {
    id: str(r.id),
    network: network(r.network),
    xPostId: str(r.x_post_id),
    authorId: str(r.author_id),
    authorUsername: strOrNull(r.author_username),
    authorName: strOrNull(r.author_name),
    text: str(r.text),
    lang: strOrNull(r.lang),
    createdAt: str(r.created_at),
    conversationId: strOrNull(r.conversation_id),
    inReplyToUserId: strOrNull(r.in_reply_to_user_id),
    url: strOrNull(r.url),
    metrics: {
      likeCount: intOf(r.like_count),
      repostCount: intOf(r.repost_count),
      replyCount: intOf(r.reply_count),
      quoteCount: intOf(r.quote_count),
      bookmarkCount: intOf(r.bookmark_count),
      impressionCount: intOf(r.impression_count),
    },
    raw: jsonParse<unknown>(r.raw_json, null),
    firstSeenAt: str(r.first_seen_at),
    lastSeenAt: str(r.last_seen_at),
  };
}

export function rowToScreening(r: Row): ScreeningRecord {
  return {
    id: str(r.id),
    postId: str(r.post_id),
    provider: str(r.provider),
    model: str(r.model),
    promptVersion: str(r.prompt_version),
    relevanceScore: intOf(r.relevance_score),
    noveltyScore: intOf(r.novelty_score),
    credibilityScore: intOf(r.credibility_score),
    strategicImportanceScore: intOf(r.strategic_importance_score),
    topic: str(r.topic),
    subtopic: str(r.subtopic),
    requiresFollowup: bool(r.requires_followup),
    reason: str(r.reason),
    summary: str(r.summary),
    recommendedAction: str(r.recommended_action),
    entities: jsonParse(r.entities_json, []),
    risks: jsonParse(r.risks_json, []),
    evidence: jsonParse(r.evidence_json, []),
    inputTokens: r.input_tokens == null ? null : intOf(r.input_tokens),
    outputTokens: r.output_tokens == null ? null : intOf(r.output_tokens),
    estimatedCostUsd: r.estimated_cost_usd == null ? null : Number(r.estimated_cost_usd),
    scoredAt: str(r.scored_at),
    createdAt: str(r.created_at),
  };
}

export function rowToState(r: Row): PostState {
  return {
    postId: str(r.post_id),
    isRead: bool(r.is_read),
    isStarred: bool(r.is_starred),
    isArchived: bool(r.is_archived),
    isDismissed: bool(r.is_dismissed),
    notes: strOrNull(r.notes),
    updatedAt: str(r.updated_at),
  };
}

export function rowToAlert(r: Row): Alert {
  return {
    id: str(r.id),
    postId: str(r.post_id),
    monitorId: strOrNull(r.monitor_id),
    severity: str(r.severity) as Alert["severity"],
    title: str(r.title),
    reason: str(r.reason),
    status: str(r.status) as Alert["status"],
    deliveryStatus: strOrNull(r.delivery_status),
    deliveryAttempts: intOf(r.delivery_attempts),
    createdAt: str(r.created_at),
    acknowledgedAt: strOrNull(r.acknowledged_at),
    resolvedAt: strOrNull(r.resolved_at),
  };
}

export function rowToDigest(r: Row): Digest {
  return {
    id: str(r.id),
    type: str(r.type) as Digest["type"],
    periodStart: str(r.period_start),
    periodEnd: str(r.period_end),
    title: str(r.title),
    executiveSummary: strOrNull(r.executive_summary),
    contentMarkdown: strOrNull(r.content_markdown),
    model: strOrNull(r.model),
    promptVersion: strOrNull(r.prompt_version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function rowToRun(r: Row): IngestionRun {
  return {
    id: str(r.id),
    monitorId: str(r.monitor_id),
    runKey: str(r.run_key),
    status: str(r.status) as IngestionRun["status"],
    startedAt: str(r.started_at),
    completedAt: strOrNull(r.completed_at),
    postsRequested: intOf(r.posts_requested),
    postsReceived: intOf(r.posts_received),
    postsNew: intOf(r.posts_new),
    postsDuplicate: intOf(r.posts_duplicate),
    postsEnqueued: intOf(r.posts_enqueued),
    estimatedXCostUsd: Number(r.estimated_x_cost_usd ?? 0),
    error: strOrNull(r.error),
    metadata: jsonParse<Record<string, unknown> | null>(r.metadata_json, null),
  };
}

export function rowToWatchlist(r: Row): Watchlist {
  return {
    id: str(r.id),
    name: str(r.name),
    slug: str(r.slug),
    description: strOrNull(r.description),
    enabled: bool(r.enabled),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function rowToVoiceProfile(r: Row): VoiceProfile {
  return {
    id: str(r.id),
    name: str(r.name),
    tone: str(r.tone),
    audience: strOrNull(r.audience),
    perspective: strOrNull(r.perspective),
    do: jsonParse<string[]>(r.do_json, []),
    dont: jsonParse<string[]>(r.dont_json, []),
    sampleReplies: jsonParse<string[]>(r.sample_replies_json, []),
    maxChars: intOf(r.max_chars, 260),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function rowToCampaign(r: Row): Campaign {
  const nets = jsonParse<string[]>(r.networks_json, ["x"]);
  return {
    id: str(r.id),
    name: str(r.name),
    slug: str(r.slug),
    description: strOrNull(r.description),
    enabled: bool(r.enabled),
    networks: nets.filter((n): n is Network => n === "x" || n === "reddit"),
    goalRepliesPerDay: intOf(r.goal_replies_per_day, 10),
    voiceProfileId: strOrNull(r.voice_profile_id),
    strategy: strOrNull(r.strategy),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function rowToReplyDraft(r: Row): ReplyDraft {
  return {
    id: str(r.id),
    postId: str(r.post_id),
    campaignId: strOrNull(r.campaign_id),
    voiceProfileId: strOrNull(r.voice_profile_id),
    body: str(r.body),
    status: str(r.status) as ReplyDraft["status"],
    source: str(r.source) as ReplyDraft["source"],
    model: strOrNull(r.model),
    promptVersion: strOrNull(r.prompt_version),
    inputTokens: r.input_tokens == null ? null : intOf(r.input_tokens),
    outputTokens: r.output_tokens == null ? null : intOf(r.output_tokens),
    estimatedCostUsd: Number(r.estimated_cost_usd ?? 0),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function rowToSentReply(r: Row): SentReply {
  return {
    id: str(r.id),
    draftId: strOrNull(r.draft_id),
    postId: str(r.post_id),
    campaignId: strOrNull(r.campaign_id),
    network: network(r.network),
    externalReplyId: strOrNull(r.external_reply_id),
    body: str(r.body),
    idempotencyKey: str(r.idempotency_key),
    sentAt: str(r.sent_at),
  };
}

export function rowToEngagementSession(r: Row): EngagementSession {
  return {
    id: str(r.id),
    campaignId: strOrNull(r.campaign_id),
    goal: intOf(r.goal),
    startedAt: str(r.started_at),
    endedAt: strOrNull(r.ended_at),
    reviewed: intOf(r.reviewed),
    repliesSent: intOf(r.replies_sent),
    skipped: intOf(r.skipped),
    follows: intOf(r.follows),
    durationSeconds: intOf(r.duration_seconds),
  };
}

export function rowToEngagementEvent(r: Row): EngagementEvent {
  return {
    id: str(r.id),
    sessionId: strOrNull(r.session_id),
    campaignId: strOrNull(r.campaign_id),
    postId: str(r.post_id),
    kind: str(r.kind) as EngagementEvent["kind"],
    metadata: jsonParse<Record<string, unknown> | null>(r.metadata_json, null),
    createdAt: str(r.created_at),
  };
}

/** Encrypted-at-rest OAuth record. `*_enc` fields never leave the server. */
export interface OAuthTokenRow {
  id: string;
  accountKey: string;
  network: Network;
  externalUserId: string | null;
  username: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  scope: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function rowToOAuthToken(r: Row): OAuthTokenRow {
  return {
    id: str(r.id),
    accountKey: str(r.account_key),
    network: network(r.network),
    externalUserId: strOrNull(r.external_user_id),
    username: strOrNull(r.username),
    accessTokenEnc: str(r.access_token_enc),
    refreshTokenEnc: strOrNull(r.refresh_token_enc),
    scope: strOrNull(r.scope),
    expiresAt: strOrNull(r.expires_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function rowToWatchlistAccount(r: Row): WatchlistAccount {
  return {
    id: str(r.id),
    watchlistId: str(r.watchlist_id),
    xUserId: strOrNull(r.x_user_id),
    username: str(r.username),
    displayName: strOrNull(r.display_name),
    priority: intOf(r.priority, 50),
    tags: jsonParse<string[]>(r.tags_json, []),
    notes: strOrNull(r.notes),
    enabled: bool(r.enabled),
    resolvedAt: strOrNull(r.resolved_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}
