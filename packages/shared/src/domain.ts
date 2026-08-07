/** Canonical shared domain types (spec §61). Import these everywhere; never redefine. */

/**
 * How a monitor is collected. These name X API call shapes; the platform a monitor
 * belongs to is carried separately by `network`, so a Reddit monitor is
 * `{ type: "recent_search", network: "reddit" }` and picks search-vs-new from whether
 * it has keywords.
 */
export type MonitorType =
  | "recent_search"
  | "user_watchlist"
  | "x_list"
  | "filtered_stream_rule";

export type SourceType =
  | "recent_search"
  | "user_timeline"
  | "x_list"
  | "webhook"
  | "reddit_collect";

/** Which platform a post/monitor belongs to. */
export type Network = "x" | "reddit";

export interface Monitor {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: MonitorType;
  network: Network;
  /** Reddit only: subreddits to restrict to (empty = site-wide). */
  subreddits: string[];
  /** Reddit only: keyword terms OR-ed into the search query. */
  keywords: string[];
  enabled: boolean;
  priority: number;
  xQuery: string | null;
  xListId: string | null;
  pollIntervalMinutes: number;
  maxResultsPerRun: number;
  maxPagesPerRun: number;
  prefilterThreshold: number;
  aiScreeningThreshold: number;
  alertThreshold: number;
  language: string | null;
  excludedTerms: string[];
  requiredTerms: string[];
  schedule: Record<string, unknown> | null;
  budget: { dailyResourceLimit?: number } | null;
  sinceId: string | null;
  paginationState: Record<string, unknown> | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Watchlist {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistAccount {
  id: string;
  watchlistId: string;
  xUserId: string | null;
  username: string;
  displayName: string | null;
  priority: number;
  tags: string[];
  notes: string | null;
  enabled: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostMetrics {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
  impressionCount: number;
}

export interface NormalizedXPost {
  /** Platform this post came from. Defaults to "x" for legacy callers. */
  network?: Network;
  /** External post id — an X snowflake id, or a Reddit fullname (`t3_…`). */
  xPostId: string;
  authorId: string;
  authorUsername: string | null;
  authorName: string | null;
  text: string;
  lang: string | null;
  createdAt: string;
  conversationId: string | null;
  inReplyToUserId: string | null;
  url: string | null;
  metrics: PostMetrics;
  /** Untrusted, unmodified upstream payload for audit/dev view. */
  raw: unknown;
}

export interface MonitorMatch {
  postId: string;
  monitorId: string;
  matchedRule: string | null;
  matchMetadata: Record<string, unknown> | null;
  matchedAt: string;
}

export interface PrefilterFactor {
  key: string;
  label: string;
  points: number;
}

export type PrefilterDecision = "pass" | "reject";

export interface PrefilterResult {
  score: number;
  keywordScore: number;
  sourceScore: number;
  engagementScore: number;
  primarySourceScore: number;
  penaltyScore: number;
  decision: PrefilterDecision;
  reasons: PrefilterFactor[];
  rulesVersion: string;
}

export interface ScreeningEntity {
  name: string;
  type:
    | "company"
    | "person"
    | "drug"
    | "target"
    | "trial"
    | "model"
    | "technology"
    | "regulator"
    | "conference"
    | "other";
}

export interface ScreeningResult {
  relevanceScore: number;
  noveltyScore: number;
  credibilityScore: number;
  strategicImportanceScore: number;
  topic: string;
  subtopic: string;
  requiresFollowup: boolean;
  reason: string;
  summary: string;
  recommendedAction: string;
  entities: ScreeningEntity[];
  risks: string[];
  evidence: string[];
}

export interface ScreeningRecord extends ScreeningResult {
  id: string;
  postId: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  scoredAt: string;
  createdAt: string;
}

export type AlertSeverity = "info" | "medium" | "high" | "critical";
export type AlertStatus = "open" | "acknowledged" | "dismissed" | "resolved";

export interface Alert {
  id: string;
  postId: string;
  monitorId: string | null;
  severity: AlertSeverity;
  title: string;
  reason: string;
  status: AlertStatus;
  deliveryStatus: string | null;
  deliveryAttempts: number;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export type DigestType = "daily" | "weekly" | "custom";

export interface Digest {
  id: string;
  type: DigestType;
  periodStart: string;
  periodEnd: string;
  title: string;
  executiveSummary: string | null;
  contentMarkdown: string | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IngestionRunStatus =
  | "running"
  | "success"
  | "failed"
  | "skipped_budget"
  | "skipped_not_due"
  | "skipped_disabled";

export interface IngestionRun {
  id: string;
  monitorId: string;
  runKey: string;
  status: IngestionRunStatus;
  startedAt: string;
  completedAt: string | null;
  postsRequested: number;
  postsReceived: number;
  postsNew: number;
  postsDuplicate: number;
  postsEnqueued: number;
  estimatedXCostUsd: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ApiUsage {
  id: string;
  provider: "x" | "anthropic";
  operation: string;
  monitorId: string | null;
  resourceCount: number;
  requestCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

export interface AppSettings {
  key: string;
  value: unknown;
  isSecretReference: boolean;
  updatedAt: string;
}

export interface PostState {
  postId: string;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isDismissed: boolean;
  notes: string | null;
  updatedAt: string;
}

export interface CursorPage<T> {
  data: T[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

// ── Engagement layer ─────────────────────────────────────────────────────────

/** One-time "how do I sound" setup that reply drafting is conditioned on. */
export interface VoiceProfile {
  id: string;
  name: string;
  tone: string;
  audience: string | null;
  perspective: string | null;
  /** Things the reply should do (e.g. "cite a concrete number"). */
  do: string[];
  /** Things the reply must never do (e.g. "no emoji", "never pitch"). */
  dont: string[];
  /** Prior replies used as few-shot style anchors. */
  sampleReplies: string[];
  maxChars: number;
  createdAt: string;
  updatedAt: string;
}

/** An independent strategy: its own networks, monitors, voice, and daily goal. */
export interface Campaign {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  networks: Network[];
  goalRepliesPerDay: number;
  voiceProfileId: string | null;
  strategy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReplyDraftStatus = "draft" | "sent" | "discarded";
export type ReplyDraftSource = "ai" | "manual" | "transform";

export interface ReplyDraft {
  id: string;
  postId: string;
  campaignId: string | null;
  voiceProfileId: string | null;
  body: string;
  status: ReplyDraftStatus;
  source: ReplyDraftSource;
  model: string | null;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface SentReply {
  id: string;
  draftId: string | null;
  postId: string;
  campaignId: string | null;
  network: Network;
  externalReplyId: string | null;
  body: string;
  idempotencyKey: string;
  sentAt: string;
}

export type EngagementEventKind = "engaged" | "skipped" | "replied" | "followed" | "drafted";

export interface EngagementEvent {
  id: string;
  sessionId: string | null;
  campaignId: string | null;
  postId: string;
  kind: EngagementEventKind;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface EngagementSession {
  id: string;
  campaignId: string | null;
  goal: number;
  startedAt: string;
  endedAt: string | null;
  reviewed: number;
  repliesSent: number;
  skipped: number;
  follows: number;
  durationSeconds: number;
}

/** Aggregate triage history used to sharpen queue ranking over time. */
export interface EngagementSignals {
  /** author username (lowercased) → net engaged-minus-skipped count. */
  authorAffinity: Record<string, number>;
  /** topic → net engaged-minus-skipped count. */
  topicAffinity: Record<string, number>;
  totalEngaged: number;
  totalSkipped: number;
}

export type ReplyTransform = "rewrite" | "autocomplete" | "shorter" | "longer";

export type SafetyWarningCode =
  | "engagement_bait"
  | "duplicate_reply"
  | "link_overuse"
  | "too_long"
  | "empty"
  | "excessive_hashtags"
  | "excessive_mentions"
  | "all_caps"
  | "self_promo";

export type SafetySeverity = "warn" | "block";

export interface SafetyWarning {
  code: SafetyWarningCode;
  severity: SafetySeverity;
  message: string;
  /** The literal text that triggered it, when applicable. */
  evidence: string | null;
}

export interface SafetyReport {
  warnings: SafetyWarning[];
  /** True when nothing is a hard block. Warn-level items are dismissible. */
  sendable: boolean;
  rulesVersion: string;
}

/** A ranked item in the engage inbox. */
export interface EngageItem {
  post: {
    id: string;
    network: Network;
    xPostId: string;
    authorUsername: string | null;
    authorName: string | null;
    text: string;
    url: string | null;
    createdAt: string;
    metrics: PostMetrics;
  };
  topic: string | null;
  strategicScore: number | null;
  relevanceScore: number | null;
  summary: string | null;
  /** Queue rank score (0..100) — screening + recency + learned affinity. */
  queueScore: number;
  reasons: string[];
  draftCount: number;
  monitorNames: string[];
}
